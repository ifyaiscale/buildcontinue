import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AUTH_MATERIAL = "limitless_admin_auth_material?id=eq.production&select=public_jwk";
const CRYPTO_MATERIAL = "limitless_provider_crypto_material?id=eq.production&select=key_jwk";
const POLICY_VERSION = 2;
const ACCEPTANCE_VERSION = 1;

type Obj = Record<string, unknown>;
type Brand = Obj & {
  id: string;
  slug: string;
  name: string;
  domain: string;
  supportEmail?: string;
  status: string;
  mode: string;
  shippingPrice: number;
  freeShippingThreshold: number;
  products: Array<Obj & { id: string; variantId?: string; price: number; available: boolean }>;
  shopify: { status: string; account?: string };
  whop: { status: string; account?: string };
  checkoutExperience?: Obj;
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function obj(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
}

function text(value: unknown, max = 2000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : "";
}

function fromB64url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...hash].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function rest(path: string, init: RequestInit = {}) {
  const base = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function rpc<T = unknown>(name: string, body: Obj): Promise<T> {
  const response = await rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) {
    let message = "Launch state could not be updated.";
    try {
      const payload = await response.json() as Obj;
      if (typeof payload.message === "string") message = payload.message.replace(/_/g, " ");
    } catch { /* no-op */ }
    throw new HttpError(response.status === 404 ? 404 : 409, message);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

async function validToken(token: string) {
  if (!token || token.length > 2048) return false;
  const [encoded, signature, ...extra] = token.split(".");
  if (extra.length || !encoded || !signature) return false;
  try {
    const response = await rest(AUTH_MATERIAL);
    if (!response.ok) return false;
    const rows = await response.json() as Array<{ public_jwk?: JsonWebKey }>;
    const jwk = rows[0]?.public_jwk;
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromB64url(signature), encoder.encode(encoded));
    if (!ok) return false;
    const payload = JSON.parse(decoder.decode(fromB64url(encoded))) as { v?: number; aud?: string; iat?: number; exp?: number; nonce?: string };
    const now = Math.floor(Date.now() / 1000);
    return payload.v === 2 && payload.aud === "limitless-admin" && Number.isInteger(payload.iat) && Number.isInteger(payload.exp) && typeof payload.nonce === "string" && payload.exp! > now && payload.exp! <= now + 8 * 60 * 60 + 60;
  } catch {
    return false;
  }
}

let keyPromise: Promise<CryptoKey> | null = null;
async function cryptoKey() {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const response = await rest(CRYPTO_MATERIAL);
    if (!response.ok) throw new HttpError(503, "Launch encryption is unavailable.");
    const rows = await response.json() as Array<{ key_jwk?: JsonWebKey }>;
    const k = typeof rows[0]?.key_jwk?.k === "string" ? rows[0]!.key_jwk!.k! : "";
    const raw = fromB64url(k);
    if (raw.byteLength !== 32) throw new HttpError(503, "Launch encryption is unavailable.");
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  })();
  try {
    return await keyPromise;
  } catch (error) {
    keyPromise = null;
    throw error;
  }
}

async function providerCredential<T>(brandId: string, provider: "shopify" | "whop"): Promise<T | null> {
  const response = await rest(`limitless_provider_credentials_v2?brand_id=eq.${encodeURIComponent(brandId)}&provider=eq.${provider}&select=iv,ciphertext`);
  if (!response.ok) return null;
  const rows = await response.json() as Array<{ iv?: string; ciphertext?: string }>;
  const row = rows[0];
  if (!row?.iv || !row.ciphertext) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(row.iv), additionalData: encoder.encode(`limitless:${brandId}:${provider}:v2`) },
      await cryptoKey(),
      fromB64url(row.ciphertext),
    );
    return JSON.parse(decoder.decode(decrypted)) as T;
  } catch {
    return null;
  }
}

async function brand(brandId: string) {
  if (!/^brand_[A-Za-z0-9-]+$/.test(brandId)) throw new HttpError(422, "Invalid brand.");
  const value = await rpc<Brand | null>("limitless_checkout_brand_by_id", { p_brand_id: brandId });
  if (!value) throw new HttpError(404, "Brand not found.");
  return value;
}

async function metadata(key: string) {
  return await rpc<string | null>("limitless_launch_metadata_get", { p_key: key });
}

async function runtimeConfig() {
  const response = await rest("limitless_checkout_runtime_config?id=eq.production&select=payment_acceptance_enabled,public_payment_enabled");
  if (!response.ok) throw new HttpError(503, "Payment gates are unavailable.");
  const rows = await response.json() as Array<{ payment_acceptance_enabled?: boolean; public_payment_enabled?: boolean }>;
  return {
    acceptance: rows[0]?.payment_acceptance_enabled === true,
    public: rows[0]?.public_payment_enabled === true,
  };
}

function policyFor(b: Brand) {
  const personalized = b.slug === "facejamas";
  const returns = personalized
    ? {
        returns: "Because FaceJamas products are made from customer-supplied personalization, personalized items are final sale except when the item arrives damaged, defective, incorrect, or with a verified production error.",
        refunds: "When a qualifying personalized-order issue is verified, FaceJamas may replace, correct, or refund the affected item as appropriate. Optional priority-processing fees are not refundable after priority processing has begun.",
        cancellations: "Personalized-order cancellation requests are accepted before production begins, but cancellation cannot be guaranteed once production has started.",
      }
    : {
        returns: "Eligible non-personalized items may be requested for return within 30 days of delivery. Returned items must be unused and in their original condition. Contact support before sending a return. Damaged, defective, or incorrect items will be reviewed for replacement, correction, or refund as appropriate.",
        refunds: "Approved refunds are issued to the original payment method after the return or issue has been reviewed. Optional priority-processing fees are not refundable after priority processing has begun.",
        cancellations: "Cancellation requests are accepted before fulfillment or production begins, but cancellation cannot be guaranteed once processing, fulfillment, or production has started.",
      };

  return {
    version: POLICY_VERSION,
    brandId: b.id,
    brandSlug: b.slug,
    support: {
      email: String(b.supportEmail || "").trim(),
      statement: "Questions about an order, return, refund, cancellation, damage, or delivery should be sent to the monitored support contact for this brand.",
    },
    shipping: {
      standard: "Free standard shipping is included on every launch order. Delivery estimates are not guarantees and can vary by destination, fulfillment timing, carrier conditions, customs, or other circumstances outside the store's control.",
      priority: "Optional $4.99 priority processing applies once per order when selected. It moves the order into the priority-processing workflow but does not upgrade the carrier service or guarantee a delivery date.",
      taxes: "Applicable destination taxes and the authoritative USD order total are calculated at checkout using Shopify data through Limitless Checkout.",
    },
    returns,
    privacy: personalized
      ? {
          general: "Checkout and order information is used to process the purchase, provide support, and fulfill the order. Payment-card entry is hosted by the configured payment provider and raw card details are not collected by the storefront or Limitless Checkout.",
          sourcePhoto: "FaceJamas source photos are stored privately and are not placed in public cart, checkout, payment, or Shopify image URLs.",
          fulfillmentReference: "The Shopify order stores an opaque Personalization ID on the relevant line item. Authorized fulfillment staff or agents can use that reference through private fulfillment tooling to retrieve the matching source artwork; the source image itself remains private.",
          fulfillmentAccess: "Private artwork access must be authenticated and time-limited. Fulfillment providers receive only the order and artwork access needed to manufacture or ship the customer's personalized item.",
          abandonedUploadRetention: "Expired unclaimed FaceJamas source uploads are deleted after the 30-day upload receipt window.",
          orderedArtworkRetention: "Ordered FaceJamas source artwork is retained for fulfillment and replacement support for 90 days after it is bound to the Shopify order, then the private source file is deleted while non-image order and audit metadata may remain.",
        }
      : {
          general: "Checkout and order information is used to process the purchase, provide customer support, prevent fraud, and fulfill the order. Payment-card entry is hosted by the configured payment provider and raw card details are not collected by the storefront or Limitless Checkout.",
        },
    productSpecific: b.slug === "cozyinfants"
      ? [
          "Cuddle Bears are comfort products for supervised use and are not marketed as medical treatment, anxiety treatment, or infant sleep products.",
          "Final age guidance, care instructions, battery information, warnings, and safety instructions must match the manufactured product and packaging.",
        ]
      : b.slug === "chefings"
        ? [
            "Chefings ingredient compatibility, cleaning instructions, materials, battery or power details, blade handling, and safety claims must match the final manufactured product and instructions.",
          ]
        : [
            "The browser preview confirms the customer's selected source image. Normal manufacturing variation in print placement or color may occur unless a specific production proof is expressly provided.",
            "Customers must have permission to use the image they upload for a personalized product and must not upload content that infringes another person's rights.",
          ],
  };
}

async function policyStatus(b: Brand) {
  const policy = policyFor(b);
  const policyHash = await sha256(JSON.stringify(policy));
  const raw = await metadata(`launch_policy_approval:${b.id}`);
  let saved: Obj = {};
  try { saved = raw ? JSON.parse(raw) as Obj : {}; } catch { /* no-op */ }
  const approved = saved.version === POLICY_VERSION && saved.brandId === b.id && saved.policyHash === policyHash;
  return {
    policy,
    policyHash,
    approved,
    approvedAt: approved && typeof saved.approvedAt === "string" ? saved.approvedAt : null,
    supportContactConfigured: Boolean(String(b.supportEmail || "").trim()),
  };
}

async function launchFingerprint(b: Brand) {
  const experience = obj(b.checkoutExperience);
  const products = b.products
    .filter(p => p.available)
    .map(p => [p.id, p.variantId ?? "", p.price])
    .sort((a, c) => String(a[0]).localeCompare(String(c[0])));
  return sha256(JSON.stringify({
    brandId: b.id,
    domain: b.domain,
    supportEmail: String(b.supportEmail || "").trim().toLowerCase(),
    shopify: b.shopify.account ?? "",
    whop: b.whop.account ?? "",
    products,
    shippingPrice: b.shippingPrice,
    freeShippingThreshold: b.freeShippingThreshold,
    checkoutExperience: Object.keys(experience).length ? {
      priorityEnabled: experience.priorityEnabled,
      priorityPrice: experience.priorityPrice,
      priorityLabel: experience.priorityLabel,
      deliveryText: experience.deliveryText,
      returnsText: experience.returnsText,
    } : null,
  }));
}

async function providerChecks(b: Brand) {
  const shopify = await providerCredential<{ domain?: string }>(b.id, "shopify");
  const whop = await providerCredential<{ companyId?: string; webhookSecret?: string }>(b.id, "whop");
  return {
    shopifyVerified: Boolean(shopify?.domain && b.shopify.status === "verified" && b.shopify.account === shopify.domain),
    whopVerified: Boolean(whop?.companyId && b.whop.status === "verified" && b.whop.account === whop.companyId),
    webhookConfigured: Boolean(whop?.webhookSecret),
    shopifyDomain: shopify?.domain || "",
    whopCompanyId: whop?.companyId || "",
  };
}

async function acceptanceCurrent(b: Brand) {
  const raw = await metadata(`launch_acceptance:${b.id}`);
  if (!raw) return null;
  let saved: Obj;
  try { saved = JSON.parse(raw) as Obj; } catch { return null; }
  if (saved.version !== ACCEPTANCE_VERSION || saved.brandId !== b.id || typeof saved.attemptId !== "string" || typeof saved.orderId !== "string" || typeof saved.totalCents !== "number" || typeof saved.launchFingerprint !== "string") return null;
  const fingerprint = await launchFingerprint(b);
  if (saved.launchFingerprint !== fingerprint || saved.shopifyDomain !== b.shopify.account || saved.whopCompanyId !== b.whop.account) return null;
  const attempt = await rpc<Obj | null>("limitless_checkout_payment_get", { p_brand_id: b.id, p_attempt_id: saved.attemptId });
  if (!attempt || attempt.state !== "completed" || attempt.orderId !== saved.orderId || Number(attempt.totalCents) !== saved.totalCents) return null;
  return { attemptId: saved.attemptId, orderId: saved.orderId, totalCents: saved.totalCents, acceptedAt: saved.acceptedAt };
}

async function readiness(b: Brand) {
  const gates = await runtimeConfig();
  const policy = await policyStatus(b);
  const providers = await providerChecks(b);
  const accepted = await acceptanceCurrent(b);
  const experience = obj(b.checkoutExperience);
  const checks = {
    paymentAcceptanceEnabled: gates.acceptance,
    publicPaymentEnabled: gates.public,
    storefrontDomainConfigured: Boolean(b.domain),
    supportContactConfigured: policy.supportContactConfigured,
    launchPoliciesApproved: policy.approved,
    shopifyVerified: providers.shopifyVerified,
    whopVerified: providers.whopVerified,
    whopWebhookConfigured: providers.webhookConfigured,
    availableCatalog: b.products.some(p => p.available && Boolean(p.variantId)),
    launchShippingPolicy: Number(b.shippingPrice) === 0 && Number(b.freeShippingThreshold) === 0 && experience.priorityEnabled === true && Number(experience.priorityPrice) === 4.99,
    faceJamasPrivateMediaConfigured: true,
    controlledAcceptanceCompleted: Boolean(accepted),
  };
  const acceptanceReady = checks.storefrontDomainConfigured && checks.supportContactConfigured && checks.launchPoliciesApproved && checks.shopifyVerified && checks.whopVerified && checks.whopWebhookConfigured && checks.availableCatalog && checks.launchShippingPolicy && checks.faceJamasPrivateMediaConfigured;
  const ready = acceptanceReady && checks.controlledAcceptanceCompleted;
  return {
    ready,
    acceptanceReady,
    checks,
    policy: { approved: policy.approved, approvedAt: policy.approvedAt, policyHash: policy.policyHash },
    acceptance: accepted,
  };
}

async function acceptanceToken(b: Brand) {
  const gates = await runtimeConfig();
  if (!gates.acceptance || gates.public) throw new HttpError(409, "Controlled acceptance is not armed privately yet.");
  const state = await readiness(b);
  if (!state.acceptanceReady) throw new HttpError(409, "Complete provider, support and policy checks before controlled acceptance.");
  const now = Date.now();
  const expiresAt = now + 20 * 60 * 1000;
  const payload = { version: 1, brandId: b.id, slug: b.slug, issuedAt: now, expiresAt, nonce: crypto.randomUUID() };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(`limitless:${b.id}:acceptance-session:v3`) },
    await cryptoKey(),
    encoder.encode(JSON.stringify(payload)),
  ));
  const token = `v3.${b64url(iv)}.${b64url(ciphertext)}`;
  return {
    token,
    expiresAt,
    url: `https://checkout.${b.domain}/acceptance/${encodeURIComponent(b.slug)}?token=${encodeURIComponent(token)}`,
  };
}

async function approvePolicy(b: Brand) {
  if (!String(b.supportEmail || "").trim()) throw new HttpError(409, "Configure a monitored support email first.");
  const policy = policyFor(b);
  const policyHash = await sha256(JSON.stringify(policy));
  const approvedAt = new Date().toISOString();
  const experience = {
    ...obj(b.checkoutExperience),
    deliveryText: "Free standard shipping on every order. Optional priority processing is $4.99 and does not change the carrier service.",
    returnsText: obj(policy.returns).returns,
  };
  await rpc("limitless_launch_policy_commit", {
    p_brand_id: b.id,
    p_checkout_experience: experience,
    p_metadata_key: "launch_policy_approval:",
    p_record: { version: POLICY_VERSION, brandId: b.id, policyHash, approvedAt },
  });
  return { approved: true, approvedAt, policyHash };
}

async function recordAcceptance(b: Brand, attemptId: string) {
  if (!/^attempt_[0-9a-f-]{36}$/.test(attemptId)) throw new HttpError(422, "Invalid payment attempt.");
  const policy = await policyStatus(b);
  const providers = await providerChecks(b);
  if (!policy.approved || !policy.supportContactConfigured || !providers.shopifyVerified || !providers.whopVerified || !providers.webhookConfigured) throw new HttpError(409, "Launch checks changed; run acceptance again after fixing them.");
  const attempt = await rpc<Obj | null>("limitless_checkout_payment_get", { p_brand_id: b.id, p_attempt_id: attemptId });
  if (!attempt || attempt.state !== "completed" || typeof attempt.orderId !== "string") throw new HttpError(409, "Controlled acceptance requires a completed verified payment and Shopify order.");
  if (attempt.shopifyDomain !== b.shopify.account || attempt.whopCompanyId !== b.whop.account) throw new HttpError(409, "The accepted payment used different provider accounts.");
  const record = {
    version: ACCEPTANCE_VERSION,
    brandId: b.id,
    attemptId,
    orderId: attempt.orderId,
    totalCents: Number(attempt.totalCents),
    shopifyDomain: String(attempt.shopifyDomain),
    whopCompanyId: String(attempt.whopCompanyId),
    launchFingerprint: await launchFingerprint(b),
    acceptedAt: new Date().toISOString(),
  };
  await rpc("limitless_launch_acceptance_commit", { p_brand_id: b.id, p_record: record });
  return record;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let payload: Obj;
  try { payload = await req.json() as Obj; } catch { return json({ error: "Invalid request." }, 400); }
  const token = typeof payload.token === "string" ? payload.token : "";
  if (!(await validToken(token))) return json({ error: "Sign in to manage your workspace." }, 401);
  try {
    const action = text(payload.action, 80);
    const b = await brand(text(payload.brandId, 100));
    if (action === "policy-status") return json(await policyStatus(b));
    if (action === "readiness") return json(await readiness(b));
    if (action === "update-support") {
      const email = text(payload.email, 254);
      const updated = await rpc<Brand>("limitless_launch_update_support", { p_brand_id: b.id, p_email: email });
      return json(updated);
    }
    if (action === "approve-policy") {
      if (payload.acknowledge !== true) throw new HttpError(422, "Confirm that you reviewed and approve the current launch policies.");
      return json(await approvePolicy(b), 201);
    }
    if (action === "issue-acceptance") return json(await acceptanceToken(b), 201);
    if (action === "record-acceptance") return json(await recordAcceptance(b, text(payload.attemptId, 100)), 201);
    if (action === "activate-live") {
      const state = await readiness(b);
      if (!state.ready) throw new HttpError(409, "Controlled acceptance is not complete for the current launch configuration.");
      const updated = await rpc<Brand>("limitless_launch_activate_brand", { p_brand_id: b.id });
      return json(updated, 201);
    }
    throw new HttpError(404, "Launch action not found.");
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("launch-admin", error);
    return json({ error: "Launch administration is temporarily unavailable." }, 503);
  }
});
