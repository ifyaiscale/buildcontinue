import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SHOPIFY_VERSION = "2026-07";
const CART_TTL_MS = 30 * 60 * 1000;
const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ATTEMPT_TTL_MS = 15 * 60 * 1000;
const MAX_CART_TOKEN = 16000;
const COUNTRY_CODES = new Set(["US", "CA", "GB", "NZ", "AU"]);
const POSTAL: Record<string, RegExp> = {
  US: /^\d{5}(?:-\d{4})?$/,
  CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/,
  GB: /^(?:GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/,
  NZ: /^\d{4}$/,
  AU: /^\d{4}$/,
};
const REF_RE = /^pers_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROOF_RE = /^[A-Za-z0-9_-]{40,100}$/;

type AnyObject = Record<string, unknown>;
type Brand = AnyObject & {
  id: string;
  slug: string;
  name: string;
  domain: string;
  supportEmail?: string;
  status: string;
  mode: string;
  shippingPrice: number;
  freeShippingThreshold: number;
  products: Array<AnyObject & {
    id: string;
    variantId?: string;
    available: boolean;
    price: number;
    title?: string;
    description?: string;
    image?: string;
  }>;
  shopify: { status: string; account?: string };
  whop: { status: string; account?: string };
  accountDetails?: { storefrontAliases?: string[] };
  checkoutExperience?: {
    priorityEnabled?: boolean;
    priorityPrice?: number;
    priorityLabel?: string;
    deliveryText?: string;
    returnsText?: string;
  };
};
type ShopifyCredential = {
  provider?: string;
  domain: string;
  accessToken?: string;
  authMethod?: string;
  clientId?: string;
  clientSecret?: string;
};
type WhopCredential = { provider?: string; companyId: string; apiKey: string; webhookSecret?: string };
type CartItem = { productId: string; quantity: number; personalizationRef?: string };
type Address = {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  provinceCode?: string;
  zip: string;
  countryCode: string;
};
type CartPayload = {
  version: 3;
  brandId: string;
  slug: string;
  items: CartItem[];
  issuedAt: number;
  expiresAt: number;
};
type ReceiptPayload = {
  version: 3;
  brandId: string;
  slug: string;
  key: string;
  issuedAt: number;
  expiresAt: number;
};
type BundleTier = {
  key: "duo" | "trio" | "family";
  minQuantity: number;
  percentOff: number;
  title: string;
  discountNodeId: string;
};

const BUNDLE_TIERS: Record<string, readonly BundleTier[]> = Object.freeze({
  chefings: Object.freeze([
    Object.freeze({ key: "duo", minQuantity: 2, percentOff: 10, title: "Limitless Duo — 10% off 2+", discountNodeId: "gid://shopify/DiscountAutomaticNode/1331055329349" }),
    Object.freeze({ key: "trio", minQuantity: 3, percentOff: 15, title: "Limitless Trio — 15% off 3+", discountNodeId: "gid://shopify/DiscountAutomaticNode/1331055362117" }),
    Object.freeze({ key: "family", minQuantity: 4, percentOff: 20, title: "Limitless Family — 20% off 4+", discountNodeId: "gid://shopify/DiscountAutomaticNode/1331055394885" }),
  ]),
  cozyinfants: Object.freeze([
    Object.freeze({ key: "duo", minQuantity: 2, percentOff: 10, title: "Limitless Duo — 10% off 2+", discountNodeId: "gid://shopify/DiscountAutomaticNode/1487671296174" }),
    Object.freeze({ key: "trio", minQuantity: 3, percentOff: 15, title: "Limitless Trio — 15% off 3+", discountNodeId: "gid://shopify/DiscountAutomaticNode/1487671328942" }),
    Object.freeze({ key: "family", minQuantity: 4, percentOff: 20, title: "Limitless Family — 20% off 4+", discountNodeId: "gid://shopify/DiscountAutomaticNode/1487671361710" }),
  ]),
  facejamas: Object.freeze([
    Object.freeze({ key: "duo", minQuantity: 2, percentOff: 10, title: "Limitless Duo — 10% off 2+", discountNodeId: "gid://shopify/DiscountAutomaticNode/1475042115797" }),
    Object.freeze({ key: "trio", minQuantity: 3, percentOff: 15, title: "Limitless Trio — 15% off 3+", discountNodeId: "gid://shopify/DiscountAutomaticNode/1475042148565" }),
    Object.freeze({ key: "family", minQuantity: 4, percentOff: 20, title: "Limitless Family — 20% off 4+", discountNodeId: "gid://shopify/DiscountAutomaticNode/1475042181333" }),
  ]),
});

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
function text(value: unknown, max: number, allowEmpty = false) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if ((!allowEmpty && !v) || v.length > max) return "";
  return v;
}
function asObject(value: unknown): AnyObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyObject : {};
}
function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function sha256Hex(value: string) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...hash].map(b => b.toString(16).padStart(2, "0")).join("");
}
function safeHexEqual(a: string, b: string) {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
async function rpc<T = unknown>(name: string, body: AnyObject): Promise<T> {
  const response = await rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) {
    let message = "Checkout state could not be updated safely.";
    try {
      const payload = await response.json() as AnyObject;
      if (typeof payload.message === "string" && /^[a-z0-9_]+$/i.test(payload.message)) message = payload.message;
    } catch { /* no-op */ }
    const status = /conflict|busy|claimed|unavailable|expired|mismatch|changed/.test(message) ? 409 : 503;
    throw new HttpError(status, message.replace(/_/g, " "));
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

let keyPromise: Promise<CryptoKey> | null = null;
async function cryptoKey() {
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const response = await rest("limitless_provider_crypto_material?id=eq.production&select=key_jwk");
    if (!response.ok) throw new HttpError(503, "Checkout encryption is unavailable.");
    const rows = await response.json() as Array<{ key_jwk?: JsonWebKey }>;
    const k = typeof rows[0]?.key_jwk?.k === "string" ? rows[0]!.key_jwk!.k! : "";
    if (!k) throw new HttpError(503, "Checkout encryption is unavailable.");
    const raw = fromB64url(k);
    if (raw.byteLength !== 32) throw new HttpError(503, "Checkout encryption is unavailable.");
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  })();
  try {
    return await keyPromise;
  } catch (error) {
    keyPromise = null;
    throw error;
  }
}
async function encryptToken(brandId: string, purpose: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(`limitless:${brandId}:${purpose}:v3`) },
    await cryptoKey(),
    encoder.encode(JSON.stringify(value)),
  ));
  return `v3.${b64url(iv)}.${b64url(encrypted)}`;
}
async function decryptToken<T>(brandId: string, purpose: string, token: string): Promise<T> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v3") {
    throw new HttpError(422, "This checkout link is invalid. Return to the store and try again.");
  }
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(parts[1]), additionalData: encoder.encode(`limitless:${brandId}:${purpose}:v3`) },
      await cryptoKey(),
      fromB64url(parts[2]),
    );
    return JSON.parse(decoder.decode(decrypted)) as T;
  } catch {
    throw new HttpError(422, "This checkout link is invalid. Return to the store and try again.");
  }
}
async function encryptBlob(brandId: string, purpose: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(`limitless:${brandId}:${purpose}:v3`) },
    await cryptoKey(),
    encoder.encode(JSON.stringify(value)),
  ));
  return { iv: b64url(iv), ciphertext: b64url(ciphertext) };
}
async function decryptBlob<T>(brandId: string, purpose: string, iv: string, ciphertext: string): Promise<T> {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(iv), additionalData: encoder.encode(`limitless:${brandId}:${purpose}:v3`) },
      await cryptoKey(),
      fromB64url(ciphertext),
    );
    return JSON.parse(decoder.decode(decrypted)) as T;
  } catch {
    throw new HttpError(409, "Saved checkout context could not be verified.");
  }
}
async function providerCredential<T>(brandId: string, provider: "shopify" | "whop"): Promise<T> {
  const response = await rest(`limitless_provider_credentials_v2?brand_id=eq.${encodeURIComponent(brandId)}&provider=eq.${provider}&select=iv,ciphertext`);
  if (!response.ok) throw new HttpError(503, `${provider} connection is unavailable.`);
  const rows = await response.json() as Array<{ iv?: string; ciphertext?: string }>;
  if (!rows[0]?.iv || !rows[0]?.ciphertext) throw new HttpError(409, `Connect ${provider} first.`);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64url(rows[0].iv!), additionalData: encoder.encode(`limitless:${brandId}:${provider}:v2`) },
      await cryptoKey(),
      fromB64url(rows[0].ciphertext!),
    );
    return JSON.parse(decoder.decode(decrypted)) as T;
  } catch {
    throw new HttpError(503, `${provider} connection could not be decrypted.`);
  }
}
async function brandBySlug(slug: string): Promise<Brand> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HttpError(404, "Store not found.");
  const brand = await rpc<Brand | null>("limitless_checkout_brand_by_slug", { p_slug: slug });
  if (!brand || brand.slug !== slug || !Array.isArray(brand.products)) throw new HttpError(404, "Store not found.");
  return brand;
}
async function runtimeConfig() {
  const response = await rest("limitless_checkout_runtime_config?id=eq.production&select=payment_acceptance_enabled,public_payment_enabled");
  if (!response.ok) throw new HttpError(503, "Checkout gate state is unavailable.");
  const rows = await response.json() as Array<{ payment_acceptance_enabled?: boolean; public_payment_enabled?: boolean }>;
  return {
    acceptance: rows[0]?.payment_acceptance_enabled === true,
    public: rows[0]?.public_payment_enabled === true,
  };
}

async function clientHash(req: Request) {
  const forwarded = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim().slice(0, 128);
  const ua = (req.headers.get("user-agent") || "unknown").slice(0, 200);
  return sha256Hex(`${forwarded}|${ua}`);
}
async function rateLimit(req: Request, bucket: string, max: number, windowMs: number) {
  const hash = await clientHash(req);
  const since = new Date(Date.now() - windowMs).toISOString();
  const response = await rest(`limitless_checkout_rate_events?bucket=eq.${encodeURIComponent(bucket)}&client_hash=eq.${hash}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=${max}`);
  if (!response.ok) throw new HttpError(503, "Checkout throttling is unavailable.");
  const rows = await response.json() as unknown[];
  if (rows.length >= max) throw new HttpError(429, "Too many checkout requests. Try again shortly.");
  await rest("limitless_checkout_rate_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ bucket, client_hash: hash }),
  });
  if (Math.random() < 0.01) {
    void rest(`limitless_checkout_rate_events?created_at=lt.${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }
}

function publicBrand(brand: Brand) {
  const result: AnyObject = { ...brand };
  delete result.accountDetails;
  result.shopify = { status: brand.shopify?.status };
  result.whop = { status: brand.whop?.status };
  result.products = brand.products.map(product => {
    const p: AnyObject = { ...product };
    delete p.variantId;
    return p;
  });
  return result;
}
function variantKey(value: string) {
  const v = value.trim();
  const gid = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/.exec(v);
  if (gid) return `shopify:${gid[1]}`;
  if (/^\d+$/.test(v)) return `shopify:${v}`;
  return `id:${v}`;
}
function resolveProductId(brand: Brand, requested: string) {
  const key = variantKey(requested);
  const matches = brand.products.filter(product => [product.id, product.variantId].filter(Boolean).some(value => variantKey(String(value)) === key));
  if (matches.length !== 1) throw new HttpError(409, "A cart item no longer matches this store catalog. Return to the store and try checkout again.");
  if (!matches[0].available) throw new HttpError(409, "A cart item is no longer available. Return to the store and update your cart.");
  return matches[0].id;
}
function cartInput(raw: unknown) {
  const input = asObject(raw);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 30) throw new HttpError(422, "Cart data is invalid.");
  return input.items.map(rawItem => {
    const item = asObject(rawItem);
    const variantId = text(item.variantId, 200);
    const quantity = item.quantity;
    if (!variantId || !Number.isInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 20) throw new HttpError(422, "Cart data is invalid.");
    const personalizationRef = item.personalizationRef === undefined ? undefined : text(item.personalizationRef, 100);
    const personalizationProof = item.personalizationProof === undefined ? undefined : text(item.personalizationProof, 120);
    return { variantId, quantity: Number(quantity), personalizationRef, personalizationProof };
  });
}
async function verifyPersonalizations(brand: Brand, items: ReturnType<typeof cartInput>) {
  const has = items.some(item => item.personalizationRef || item.personalizationProof);
  if (brand.slug !== "facejamas") {
    if (has) throw new HttpError(422, "Personalization references are only supported for FaceJamas.");
    return;
  }
  if (items.some(item => !item.personalizationRef || !item.personalizationProof || item.quantity !== 1)) {
    throw new HttpError(422, "Every FaceJamas item needs its own verified photo before checkout.");
  }
  const seen = new Set<string>();
  for (const item of items) {
    const ref = item.personalizationRef!;
    const proof = item.personalizationProof!;
    if (!REF_RE.test(ref) || !PROOF_RE.test(proof)) throw new HttpError(422, "A FaceJamas photo upload proof is invalid. Upload the photo again.");
    if (seen.has(ref)) throw new HttpError(422, "Each FaceJamas item needs a unique personalization reference.");
    const response = await rest(`facejamas_upload_receipts?ref=eq.${encodeURIComponent(ref)}&select=proof_hash,expires_at,attempt_id,order_id,source_deleted_at`);
    if (!response.ok) throw new HttpError(503, "FaceJamas photo verification is unavailable.");
    const rows = await response.json() as Array<{ proof_hash?: string; expires_at?: string; attempt_id?: string | null; order_id?: string | null; source_deleted_at?: string | null }>;
    const row = rows[0];
    const hash = await sha256Hex(proof);
    if (!row?.proof_hash || !safeHexEqual(row.proof_hash, hash)) throw new HttpError(422, "A FaceJamas photo upload could not be verified. Upload the photo again.");
    if (!row.expires_at || Date.parse(row.expires_at) <= Date.now() || row.attempt_id || row.order_id || row.source_deleted_at) {
      throw new HttpError(409, "That FaceJamas photo upload was already used, deleted, or expired. Upload the photo again for this order.");
    }
    seen.add(ref);
  }
}
async function createCart(brand: Brand, raw: unknown) {
  const parsed = cartInput(raw);
  await verifyPersonalizations(brand, parsed);
  const seenProducts = new Map<string, { personalized: boolean; quantity: number }>();
  const items: CartItem[] = parsed.map(item => {
    const productId = resolveProductId(brand, item.variantId);
    const prior = seenProducts.get(productId);
    if (prior) {
      const permittedFaceJamasDuplicate = brand.slug === "facejamas" && prior.personalized && Boolean(item.personalizationRef) && prior.quantity === 1 && item.quantity === 1;
      if (!permittedFaceJamasDuplicate) throw new HttpError(422, "The same Shopify variant cannot appear twice in one cart handoff.");
    } else {
      seenProducts.set(productId, { personalized: Boolean(item.personalizationRef), quantity: item.quantity });
    }
    return {
      productId,
      quantity: item.quantity,
      ...(item.personalizationRef ? { personalizationRef: item.personalizationRef } : {}),
    };
  });
  const now = Date.now();
  const payload: CartPayload = { version: 3, brandId: brand.id, slug: brand.slug, items, issuedAt: now, expiresAt: now + CART_TTL_MS };
  return { token: await encryptToken(brand.id, "storefront-cart", payload), items, expiresAt: payload.expiresAt };
}
async function readCart(brand: Brand, token: string) {
  if (!token || token.length > MAX_CART_TOKEN) throw new HttpError(422, "This cart link is invalid. Return to the store and try checkout again.");
  const payload = await decryptToken<CartPayload>(brand.id, "storefront-cart", token);
  const now = Date.now();
  if (payload.version !== 3 || payload.brandId !== brand.id || payload.slug !== brand.slug || !Array.isArray(payload.items) || payload.items.length < 1 || payload.expiresAt <= now || payload.issuedAt > now + 60000 || payload.expiresAt - payload.issuedAt > CART_TTL_MS) {
    throw new HttpError(410, "This cart link has expired. Return to the store and start checkout again.");
  }
  const refs = new Set<string>();
  for (const item of payload.items) {
    const product = brand.products.find(p => p.id === item.productId);
    if (!product?.available || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) throw new HttpError(409, "A cart item changed or became unavailable. Return to the store and update your cart.");
    if (brand.slug === "facejamas") {
      if (!item.personalizationRef || item.quantity !== 1 || refs.has(item.personalizationRef)) throw new HttpError(409, "A FaceJamas cart item has invalid personalization data.");
      refs.add(item.personalizationRef);
    } else if (item.personalizationRef) {
      throw new HttpError(422, "This cart contains unsupported personalization data.");
    }
  }
  return payload;
}
function storefrontDomains(brand: Brand) {
  const values = [brand.domain, ...(Array.isArray(brand.accountDetails?.storefrontAliases) ? brand.accountDetails!.storefrontAliases! : [])];
  const set = new Set<string>();
  for (const raw of values) {
    const d = String(raw || "").trim().toLowerCase();
    if (!d) continue;
    set.add(d);
    if (d.startsWith("www.")) set.add(d.slice(4));
    else set.add(`www.${d}`);
  }
  return set;
}
function requireStorefrontOrigin(brand: Brand, raw: unknown) {
  const origin = text(raw, 1000);
  if (!origin) throw new HttpError(403, "Open checkout from the store cart.");
  let url: URL;
  try { url = new URL(origin); } catch { throw new HttpError(403, "Open checkout from the store cart."); }
  if (url.protocol !== "https:" || !storefrontDomains(brand).has(url.hostname.toLowerCase())) throw new HttpError(403, "This storefront is not authorized for this checkout.");
}
function normalizeAddress(raw: unknown): Address {
  const a = asObject(raw);
  const countryCode = text(a.countryCode, 2).toUpperCase();
  const zip = text(a.zip, 30).toUpperCase();
  const province = a.provinceCode === undefined ? "" : text(a.provinceCode, 3).toUpperCase();
  const address: Address = {
    firstName: text(a.firstName, 80),
    lastName: text(a.lastName, 80),
    address1: text(a.address1, 200),
    city: text(a.city, 100),
    zip,
    countryCode,
  };
  const address2 = a.address2 === undefined ? "" : text(a.address2, 200, true);
  if (address2) address.address2 = address2;
  if (province) address.provinceCode = province;
  if (!address.firstName || !address.lastName || !address.address1 || !address.city || !address.zip || !COUNTRY_CODES.has(countryCode) || !POSTAL[countryCode]?.test(zip)) {
    throw new HttpError(422, "Use a valid delivery address and postal code for the selected country.");
  }
  if ((countryCode === "US" || countryCode === "CA") && !/^[A-Z]{2}$/.test(province)) throw new HttpError(422, "A two-letter state or province code is required.");
  if (countryCode === "AU" && !/^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/.test(province)) throw new HttpError(422, "Use a valid Australian state or territory code.");
  return address;
}
function checkoutInput(raw: unknown) {
  const input = asObject(raw);
  const cartToken = text(input.cartToken, MAX_CART_TOKEN);
  const email = text(input.email, 254).toLowerCase();
  const priority = input.priority === true;
  if (!cartToken || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "Enter a valid email address and checkout session.");
  return { cartToken, email, priority, shippingAddress: normalizeAddress(input.shippingAddress) };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
async function providerFetch(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(502, "Payment provider could not be reached. Try again.");
  }
  if (response.status === 401 || response.status === 403) throw new HttpError(422, "Provider rejected the current credentials or permissions.");
  if (response.status === 429) throw new HttpError(429, "Provider rate limit reached. Try again shortly.");
  if (!response.ok) throw new HttpError(502, `Provider request failed (HTTP ${response.status}).`);
  try {
    return await response.json() as AnyObject;
  } catch {
    throw new HttpError(502, "Provider returned an invalid response.");
  }
}
async function shopifyToken(c: ShopifyCredential, refresh = false) {
  if (c.authMethod !== "client_credentials") {
    if (!c.accessToken) throw new HttpError(503, "Shopify access token is unavailable.");
    return c.accessToken;
  }
  if (!c.clientId || !c.clientSecret) throw new HttpError(503, "Shopify app credentials are unavailable.");
  const key = `${c.domain}|${c.clientId}`;
  const cached = tokenCache.get(key);
  if (!refresh && cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const result = await providerFetch(`https://${c.domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret }).toString(),
  });
  const token = typeof result.access_token === "string" ? result.access_token : "";
  const expires = Number(result.expires_in);
  if (!token || !Number.isInteger(expires) || expires < 61) throw new HttpError(502, "Shopify returned an invalid access token.");
  tokenCache.set(key, { token, expiresAt: Date.now() + expires * 1000 });
  return token;
}
async function shopifyGraphql(c: ShopifyCredential, query: string, variables: AnyObject = {}) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(c.domain)) throw new HttpError(422, "Invalid Shopify store domain.");
  const call = async (refresh = false): Promise<AnyObject> => {
    let response: Response;
    try {
      response = await fetch(`https://${c.domain}/admin/api/${SHOPIFY_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await shopifyToken(c, refresh) },
        body: JSON.stringify({ query, variables }),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new HttpError(502, "Shopify could not be reached.");
    }
    if ((response.status === 401 || response.status === 403) && !refresh && c.authMethod === "client_credentials") return call(true);
    if (response.status === 429) throw new HttpError(429, "Shopify rate limit reached. Try again shortly.");
    if (!response.ok) throw new HttpError(502, `Shopify request failed (HTTP ${response.status}).`);
    const result = await response.json() as AnyObject;
    if (!result.data || (Array.isArray(result.errors) && result.errors.length)) throw new HttpError(422, "Shopify could not complete this checkout request.");
    return result.data as AnyObject;
  };
  return call();
}
function usdCents(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) throw new HttpError(502, "Shopify returned an unsupported USD amount.");
  const [whole, f = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(f.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new HttpError(502, "Shopify returned an unsupported USD amount.");
  return cents;
}
function bagCents(raw: unknown) {
  const bag = asObject(raw);
  const shop = asObject(bag.shopMoney);
  const present = asObject(bag.presentmentMoney);
  if (shop.currencyCode !== "USD" || present.currencyCode !== "USD") throw new HttpError(422, "Checkout currency must be USD.");
  const a = usdCents(shop.amount);
  const b = usdCents(present.amount);
  if (a !== b) throw new HttpError(422, "Different shop and presentment prices are not supported.");
  return b;
}
function attrs(raw: unknown) {
  return Array.isArray(raw)
    ? raw.flatMap(v => {
      const o = asObject(v);
      return typeof o.key === "string" && typeof o.value === "string" ? [{ key: o.key, value: o.value }] : [];
    }).sort((a, b) => `${a.key}\0${a.value}`.localeCompare(`${b.key}\0${b.value}`))
    : [];
}
function lineKey(variantId: string, quantity: number, attributes: unknown) {
  return JSON.stringify({ variantId, quantity, customAttributes: attrs(attributes) });
}
function expectedBundleTier(slug: string, quantity: number): BundleTier | null {
  const tiers = BUNDLE_TIERS[slug] || [];
  let selected: BundleTier | null = null;
  for (const tier of tiers) if (quantity >= tier.minQuantity) selected = tier;
  return selected;
}
function validateBundleDiscount(brand: Brand, draft: AnyObject, merch: AnyObject[], subtotalCents: number) {
  const totalQuantity = merch.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const tier = expectedBundleTier(brand.slug, totalQuantity);
  const platform = Array.isArray(draft.platformDiscounts) ? draft.platformDiscounts.map(asObject) : [];
  const totalDiscounts = bagCents(draft.totalDiscountsSet);

  if (!tier) {
    if (platform.length || totalDiscounts !== 0) throw new HttpError(422, "Shopify applied an unexpected discount.");
    return 0;
  }
  if (platform.length !== 1) throw new HttpError(422, "Shopify bundle discount does not match the launch offer.");
  const discount = platform[0];
  const node = asObject(discount.discountNode);
  const classes = Array.isArray(discount.discountClasses) ? discount.discountClasses.map(String).sort() : [];
  const platformCents = bagCents(discount.totalAmountPriceSet);
  const expectedCents = merch.reduce((sum, line) => {
    const lineCents = bagCents(line.originalUnitPriceSet) * Number(line.quantity);
    return sum + Math.round(lineCents * tier.percentOff / 100);
  }, 0);

  if (
    discount.automaticDiscount !== true ||
    discount.bxgyDiscount !== false ||
    discount.code !== null ||
    JSON.stringify(classes) !== JSON.stringify(["PRODUCT"]) ||
    discount.presentationLevel !== "line_level" ||
    discount.title !== tier.title ||
    node.id !== tier.discountNodeId ||
    platformCents !== totalDiscounts ||
    totalDiscounts !== expectedCents ||
    totalDiscounts <= 0 ||
    totalDiscounts >= subtotalCents
  ) {
    throw new HttpError(422, "Shopify bundle discount does not match the launch offer.");
  }
  return totalDiscounts;
}

async function prepareQuote(brand: Brand, shopify: ShopifyCredential, items: CartItem[], address: Address, priority: boolean) {
  if (brand.shopify?.status !== "verified" || brand.shopify.account !== shopify.domain) throw new HttpError(409, "Shopify connection does not match this brand.");
  if (Number(brand.shippingPrice) !== 0 || Number(brand.freeShippingThreshold) !== 0) throw new HttpError(409, "This checkout requires free standard shipping.");
  const exp = brand.checkoutExperience || {};
  const priorityCents = priority ? Math.round(Number(exp.priorityPrice) * 100) : 0;
  if (priority && (exp.priorityEnabled !== true || priorityCents !== 499)) throw new HttpError(409, "Priority processing must be configured at $4.99.");
  if (brand.slug === "facejamas" && items.some(i => !i.personalizationRef || i.quantity !== 1)) throw new HttpError(422, "Every FaceJamas item needs its own verified personalization before checkout.");
  if (brand.slug !== "facejamas" && items.some(i => i.personalizationRef)) throw new HttpError(422, "Personalization references are only supported for FaceJamas.");

  const lineItems = items.map(item => {
    const p = brand.products.find(x => x.id === item.productId);
    if (!p?.available || !p.variantId || !/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(p.variantId)) throw new HttpError(422, "A cart item is unavailable in Shopify.");
    return {
      variantId: p.variantId,
      quantity: item.quantity,
      ...(item.personalizationRef ? { customAttributes: [{ key: "Personalization ID", value: item.personalizationRef }] } : {}),
    };
  });

  if (brand.slug !== "facejamas" && new Set(lineItems.map(l => l.variantId)).size !== lineItems.length) throw new HttpError(422, "Duplicate variants are not supported.");
  if (brand.slug === "facejamas") {
    const refs = lineItems.map(l => attrs(l.customAttributes).find(a => a.key === "Personalization ID")?.value || "");
    if (refs.some(ref => !ref) || new Set(refs).size !== refs.length || lineItems.some(l => l.quantity !== 1)) throw new HttpError(422, "FaceJamas bundle items need unique personalization references.");
  }

  const uniqueIds = [...new Set(lineItems.map(l => l.variantId))];
  const requestedQuantity = new Map<string, number>();
  for (const line of lineItems) requestedQuantity.set(line.variantId, (requestedQuantity.get(line.variantId) || 0) + line.quantity);

  const availability = await shopifyGraphql(
    shopify,
    `query RuntimeAvailability($ids:[ID!]!){ shop{myshopifyDomain currencyCode} currentAppInstallation{accessScopes{handle}} nodes(ids:$ids){... on ProductVariant{id availableForSale sellableOnlineQuantity inventoryPolicy inventoryItem{tracked requiresShipping} requiresComponents product{status isGiftCard requiresSellingPlan}}}}`,
    { ids: uniqueIds },
  );
  const shop = asObject(availability.shop);
  if (String(shop.myshopifyDomain || "").toLowerCase() !== shopify.domain || shop.currencyCode !== "USD") throw new HttpError(409, "Shopify store identity or currency changed.");
  const install = asObject(availability.currentAppInstallation);
  const scopes = Array.isArray(install.accessScopes) ? install.accessScopes.map(s => String(asObject(s).handle || "")) : [];
  if (!scopes.some(s => s === "read_products" || s === "write_products") || !scopes.some(s => s === "read_inventory" || s === "write_inventory") || !scopes.includes("write_draft_orders")) {
    throw new HttpError(409, "Shopify permissions changed. Reconnect the store.");
  }
  const nodes = Array.isArray(availability.nodes) ? availability.nodes.map(asObject) : [];
  if (nodes.length !== uniqueIds.length) throw new HttpError(422, "Shopify changed the requested variants.");
  for (const variantId of uniqueIds) {
    const node = nodes.find(n => n.id === variantId);
    const product = asObject(node?.product);
    const inv = asObject(node?.inventoryItem);
    if (!node || product.status !== "ACTIVE" || node.availableForSale !== true || inv.requiresShipping !== true || node.requiresComponents === true || product.isGiftCard === true || product.requiresSellingPlan === true) {
      throw new HttpError(422, "This cart contains unavailable or unsupported products.");
    }
    if (inv.tracked === true && node.inventoryPolicy === "DENY" && Number(node.sellableOnlineQuantity) < (requestedQuantity.get(variantId) || 0)) {
      throw new HttpError(422, "The requested quantity is no longer available.");
    }
  }

  const priorityLine = {
    title: "Priority processing",
    quantity: 1,
    requiresShipping: false,
    taxable: true,
    originalUnitPriceWithCurrency: { amount: "4.99", currencyCode: "USD" },
  };
  const draftInput: AnyObject = {
    lineItems: [...lineItems, ...(priority ? [priorityLine] : [])],
    shippingAddress: address,
    presentmentCurrencyCode: "USD",
    acceptAutomaticDiscounts: true,
    allowDiscountCodesInCheckout: false,
    taxExempt: false,
    shippingLine: { title: "Free standard shipping", priceWithCurrency: { amount: "0.00", currencyCode: "USD" } },
  };
  const money = `shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}`;
  const calc = await shopifyGraphql(
    shopify,
    `mutation RuntimePricing($input:DraftOrderInput!){draftOrderCalculate(input:$input){userErrors{message} calculatedDraftOrder{subtotalPriceSet{${money}} totalShippingPriceSet{${money}} totalTaxSet{${money}} totalDiscountsSet{${money}} totalPriceSet{${money}} taxesIncluded shippingLine{title shippingRateHandle} warnings{errorCode field message} platformDiscounts{automaticDiscount bxgyDiscount code discountClasses presentationLevel title discountNode{id} totalAmountPriceSet{${money}}} lineItems{variant{id} quantity custom title requiresShipping taxable customAttributes{key value} originalUnitPriceSet{${money}} components{quantity}}}}}`,
    { input: draftInput },
  );
  const root = asObject(calc.draftOrderCalculate);
  if (Array.isArray(root.userErrors) && root.userErrors.length) throw new HttpError(422, "Shopify could not calculate this cart.");
  const draft = asObject(root.calculatedDraftOrder);
  if (!Object.keys(draft).length) throw new HttpError(422, "Shopify could not calculate this cart.");
  if (Array.isArray(draft.warnings) && draft.warnings.length) throw new HttpError(422, "Shopify returned pricing warnings for this cart.");

  const calculated = Array.isArray(draft.lineItems) ? draft.lineItems.map(asObject) : [];
  const merch = calculated.filter(l => Object.keys(asObject(l.variant)).length);
  const custom = calculated.filter(l => !Object.keys(asObject(l.variant)).length);
  const expected = lineItems.map(l => lineKey(l.variantId, l.quantity, "customAttributes" in l ? l.customAttributes : [])).sort();
  const actual = merch.map(l => lineKey(String(asObject(l.variant).id || ""), Number(l.quantity), l.customAttributes)).sort();
  if (merch.length !== lineItems.length || JSON.stringify(expected) !== JSON.stringify(actual) || merch.some(l => l.custom === true || l.requiresShipping !== true || (Array.isArray(l.components) && l.components.length))) {
    throw new HttpError(422, "Shopify changed the cart or personalization data.");
  }
  if (custom.length !== (priority ? 1 : 0) || custom.some(l => l.custom !== true || l.title !== "Priority processing" || Number(l.quantity) !== 1 || l.requiresShipping === true || l.taxable !== true || (Array.isArray(l.components) && l.components.length) || attrs(l.customAttributes).length || bagCents(l.originalUnitPriceSet) !== priorityCents)) {
    throw new HttpError(422, "Shopify changed the priority processing charge.");
  }

  const subtotalCents = merch.reduce((sum, l) => sum + bagCents(l.originalUnitPriceSet) * Number(l.quantity), 0);
  const discountCents = validateBundleDiscount(brand, draft, merch, subtotalCents);
  const shippingCents = bagCents(draft.totalShippingPriceSet);
  const taxCents = bagCents(draft.totalTaxSet);
  const totalCents = bagCents(draft.totalPriceSet);
  const taxesIncluded = draft.taxesIncluded === true;
  const shipping = asObject(draft.shippingLine);
  const discountedSubtotal = subtotalCents - discountCents + priorityCents;
  const expectedTotal = discountedSubtotal + (taxesIncluded ? 0 : taxCents);
  if (
    shippingCents !== 0 ||
    bagCents(draft.subtotalPriceSet) !== discountedSubtotal ||
    totalCents !== expectedTotal ||
    shipping.title !== "Free standard shipping" ||
    shipping.shippingRateHandle !== null
  ) {
    throw new HttpError(422, "Shopify totals do not match the launch shipping policy.");
  }

  return {
    draftInput,
    status: "calculated" as const,
    currency: "USD" as const,
    paymentReady: false as const,
    calculatedAt: new Date().toISOString(),
    totals: { subtotalCents, priorityCents, shippingCents, taxCents, discountCents, totalCents, taxesIncluded },
  };
}

const moneyFields = `shopMoney{amount currencyCode} presentmentMoney{amount currencyCode}`;
const draftFields = `id status email reserveInventoryUntil customAttributes{key value} totalPriceSet{${moneyFields}} totalTaxSet{${moneyFields}} totalShippingPriceSet{${moneyFields}} shippingAddress{firstName lastName address1 address2 city zip provinceCode countryCodeV2} lineItems(first:100){nodes{variant{id} quantity title customAttributes{key value}} pageInfo{hasNextPage}} order{id displayFinancialStatus}`;
function draftTag(attemptId: string) {
  return `limitless_${attemptId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}
function expectedDraftLines(draftInput: AnyObject) {
  const list = Array.isArray(draftInput.lineItems) ? draftInput.lineItems.map(asObject) : [];
  return list.map(l => l.variantId
    ? lineKey(String(l.variantId), Number(l.quantity), l.customAttributes)
    : JSON.stringify({ priority: true, quantity: Number(l.quantity), customAttributes: [] })).sort();
}
function validateDraft(
  raw: unknown,
  binding: { attemptId: string; email: string; expiresAt: number; quote: { draftInput: AnyObject; totals: AnyObject } },
  requireReservation = true,
) {
  const d = asObject(raw);
  if (!/^gid:\/\/shopify\/DraftOrder\/[1-9]\d*$/.test(String(d.id || ""))) throw new HttpError(502, "Shopify returned an incomplete draft.");
  if (String(d.email || "").toLowerCase() !== binding.email.toLowerCase() || !attrs(d.customAttributes).some(a => a.key === "limitless_attempt_id" && a.value === binding.attemptId)) {
    throw new HttpError(409, "Shopify draft customer or attempt does not match.");
  }
  if (bagCents(d.totalPriceSet) !== Number(binding.quote.totals.totalCents) || bagCents(d.totalTaxSet) !== Number(binding.quote.totals.taxCents) || bagCents(d.totalShippingPriceSet) !== 0) {
    throw new HttpError(409, "Shopify draft totals changed.");
  }
  const expectedAddr = asObject(binding.quote.draftInput.shippingAddress);
  const actualAddr = asObject(d.shippingAddress);
  for (const key of ["firstName", "lastName", "address1", "address2", "city", "zip", "provinceCode"]) {
    if (String(actualAddr[key] ?? "") !== String(expectedAddr[key] ?? "")) throw new HttpError(409, "Shopify draft delivery address changed.");
  }
  if (actualAddr.countryCodeV2 !== expectedAddr.countryCode) throw new HttpError(409, "Shopify draft destination changed.");
  const lineObj = asObject(d.lineItems);
  const nodes = Array.isArray(lineObj.nodes) ? lineObj.nodes.map(asObject) : [];
  const actual = nodes.map(l => {
    const v = asObject(l.variant);
    return v.id
      ? lineKey(String(v.id), Number(l.quantity), l.customAttributes)
      : l.title === "Priority processing"
        ? JSON.stringify({ priority: true, quantity: Number(l.quantity), customAttributes: attrs(l.customAttributes) })
        : "unsupported";
  }).sort();
  if ((lineObj.pageInfo && asObject(lineObj.pageInfo).hasNextPage === true) || JSON.stringify(expectedDraftLines(binding.quote.draftInput)) !== JSON.stringify(actual)) {
    throw new HttpError(409, "Shopify draft items or personalization properties changed.");
  }
  const order = asObject(d.order);
  if (d.status === "COMPLETED") {
    if (!order.id || order.displayFinancialStatus !== "PAID") throw new HttpError(409, "Shopify order is not marked paid.");
  } else {
    const reserve = typeof d.reserveInventoryUntil === "string" ? Date.parse(d.reserveInventoryUntil) : NaN;
    if (order.id || (requireReservation && (!Number.isFinite(reserve) || reserve < binding.expiresAt))) throw new HttpError(409, "Shopify did not retain the required inventory reservation.");
  }
  return d;
}
async function createDraft(
  shopify: ShopifyCredential,
  binding: { attemptId: string; email: string; expiresAt: number; quote: { draftInput: AnyObject; totals: AnyObject } },
) {
  const result = await shopifyGraphql(
    shopify,
    `mutation RuntimeReserve($input:DraftOrderInput!){draftOrderCreate(input:$input){draftOrder{${draftFields}} userErrors{message}}}`,
    {
      input: {
        ...binding.quote.draftInput,
        email: binding.email,
        reserveInventoryUntil: new Date(binding.expiresAt).toISOString(),
        tags: [draftTag(binding.attemptId)],
        customAttributes: [{ key: "limitless_attempt_id", value: binding.attemptId }],
        visibleToCustomer: false,
      },
    },
  );
  const root = asObject(result.draftOrderCreate);
  if (Array.isArray(root.userErrors) && root.userErrors.length) throw new HttpError(422, "Shopify could not reserve this draft.");
  return validateDraft(root.draftOrder, binding);
}
async function recoverDraft(
  shopify: ShopifyCredential,
  binding: { attemptId: string; email: string; expiresAt: number; quote: { draftInput: AnyObject; totals: AnyObject } },
) {
  const result = await shopifyGraphql(
    shopify,
    `query RuntimeRecover($query:String!){draftOrders(first:2,query:$query){nodes{${draftFields}} pageInfo{hasNextPage}}}`,
    { query: `tag:${draftTag(binding.attemptId)}` },
  );
  const root = asObject(result.draftOrders);
  const nodes = Array.isArray(root.nodes) ? root.nodes : [];
  if (nodes.length !== 1 || asObject(root.pageInfo).hasNextPage !== false) throw new HttpError(409, "Draft creation outcome remains uncertain. Do not create a replacement draft.");
  return validateDraft(nodes[0], binding);
}

function whopCents(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(502, "Whop returned an unsupported amount.");
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > 0.000001) throw new HttpError(502, "Whop returned an unsupported amount.");
  return cents;
}
async function createWhopCheckout(c: WhopCredential, input: { attemptId: string; totalCents: number; returnUrl: string }) {
  const result = await providerFetch("https://api.whop.com/api/v1/checkout_configurations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Api-Version-Date": "2026-08-21-1",
      "Idempotency-Key": input.attemptId,
    },
    body: JSON.stringify({
      account_id: c.companyId,
      plan: { initial_price: input.totalCents / 100, plan_type: "one_time", currency: "usd" },
      mode: "payment",
      metadata: { limitless_attempt_id: input.attemptId },
      redirect_url: input.returnUrl,
      allow_promo_codes: false,
    }),
  });
  const plan = asObject(result.plan);
  const metadata = asObject(result.metadata);
  if (
    !/^ch_[A-Za-z0-9]+$/.test(String(result.id || "")) ||
    result.company_id !== c.companyId ||
    result.mode !== "payment" ||
    result.currency !== "usd" ||
    !/^plan_[A-Za-z0-9]+$/.test(String(plan.id || "")) ||
    plan.plan_type !== "one_time" ||
    whopCents(plan.initial_price) !== input.totalCents ||
    metadata.limitless_attempt_id !== input.attemptId
  ) {
    throw new HttpError(502, "Whop returned a checkout that does not match this attempt.");
  }
  const url = new URL(String(result.purchase_url || ""), "https://whop.com");
  if (url.protocol !== "https:" || !/(^|\.)whop\.com$/.test(url.hostname)) throw new HttpError(502, "Whop returned an invalid checkout URL.");
  return { checkoutId: String(result.id), planId: String(plan.id), purchaseUrl: url.toString() };
}
function embedded(attempt: AnyObject) {
  const checkoutId = String(attempt.checkoutId || "");
  const purchase = String(attempt.purchaseUrl || "");
  if (!/^ch_[A-Za-z0-9]+$/.test(checkoutId) || !purchase) throw new HttpError(409, "Payment checkout is not ready for embedding.");
  const url = new URL(purchase, "https://whop.com");
  const planId = url.pathname.match(/(?:^|\/)checkout\/(plan_[A-Za-z0-9]+)\/?$/)?.[1];
  const sessionId = url.searchParams.get("session") || checkoutId;
  if (!planId || sessionId !== checkoutId || !/^ch_[A-Za-z0-9]+$/.test(sessionId)) throw new HttpError(502, "Whop returned an invalid embedded checkout session.");
  return { planId, sessionId };
}
function allowedReturnOrigin(brand: Brand, raw: unknown) {
  const value = text(raw, 1000);
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(422, "Invalid payment return origin."); }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) throw new HttpError(422, "Invalid payment return origin.");
  const host = url.hostname.toLowerCase();
  const expected = `checkout.${brand.domain.toLowerCase()}`;
  if (host !== expected && host !== "limitlesscheckout.netlify.app") throw new HttpError(422, "Payment return origin does not match this checkout.");
  return url.origin;
}
async function paymentContext(brandId: string, attempt: AnyObject) {
  if (attempt.runtimeVersion !== 3 || typeof attempt.contextIv !== "string" || typeof attempt.contextCiphertext !== "string") throw new HttpError(409, "Payment attempt uses an unsupported runtime version.");
  return decryptBlob<{ email: string; quote: { draftInput: AnyObject; totals: AnyObject }; personalizationRefs: string[] }>(
    brandId,
    "payment-context",
    attempt.contextIv,
    attempt.contextCiphertext,
  );
}

async function actionCartStart(req: Request, payload: AnyObject) {
  await rateLimit(req, "cart-start", 120, 60000);
  const brand = await brandBySlug(text(payload.slug, 100));
  requireStorefrontOrigin(brand, payload.storefrontOrigin);
  const session = await createCart(brand, payload.cart);
  return json(session);
}
async function actionView(req: Request, payload: AnyObject) {
  await rateLimit(req, "view", 240, 60000);
  const brand = await brandBySlug(text(payload.slug, 100));
  const cartToken = typeof payload.cartToken === "string" ? payload.cartToken : "";
  if (!cartToken) return json({ brand: publicBrand(brand) });
  const cart = await readCart(brand, cartToken);
  return json({ brand: publicBrand(brand), items: cart.items, expiresAt: cart.expiresAt });
}
async function actionQuote(req: Request, payload: AnyObject) {
  await rateLimit(req, "quote", 90, 60000);
  const brand = await brandBySlug(text(payload.slug, 100));
  const input = checkoutInput(payload.input);
  const cart = await readCart(brand, input.cartToken);
  const shopify = await providerCredential<ShopifyCredential>(brand.id, "shopify");
  const quote = await prepareQuote(brand, shopify, cart.items, input.shippingAddress, input.priority);
  const gates = await runtimeConfig();
  return json({
    ...quote,
    paymentEnabled: gates.public && gates.acceptance && brand.status === "live" && brand.mode === "live" && brand.whop?.status === "verified",
  });
}
async function actionPaymentStart(req: Request, payload: AnyObject) {
  await rateLimit(req, "payment-start", 12, 60000);
  const gates = await runtimeConfig();
  if (!gates.public || !gates.acceptance) throw new HttpError(409, "Customer payments are not enabled yet.");
  const brand = await brandBySlug(text(payload.slug, 100));
  if (brand.status !== "live" || brand.mode !== "live") throw new HttpError(409, "This checkout is not published for live payment yet.");
  const input = checkoutInput(payload.input);
  const confirmed = Number(asObject(payload.input).confirmedTotalCents);
  if (!Number.isSafeInteger(confirmed) || confirmed < 50 || confirmed > 10000000) throw new HttpError(422, "Invalid reviewed payment total.");
  const key = text(payload.idempotencyKey, 100);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(422, "Invalid payment reference.");
  const cart = await readCart(brand, input.cartToken);
  const shopify = await providerCredential<ShopifyCredential>(brand.id, "shopify");
  const whop = await providerCredential<WhopCredential>(brand.id, "whop");
  if (brand.whop?.status !== "verified" || brand.whop.account !== whop.companyId || !whop.apiKey || !whop.webhookSecret) throw new HttpError(409, "Whop connection does not match this brand.");
  const quote = await prepareQuote(brand, shopify, cart.items, input.shippingAddress, input.priority);
  if (quote.totals.totalCents !== confirmed) throw new HttpError(409, "The checkout total changed. Review the new total before paying.");
  const origin = allowedReturnOrigin(brand, payload.returnOrigin);
  const receipt: ReceiptPayload = { version: 3, brandId: brand.id, slug: brand.slug, key, issuedAt: Date.now(), expiresAt: Date.now() + RECEIPT_TTL_MS };
  const receiptToken = await encryptToken(brand.id, "customer-receipt", receipt);
  const returnUrl = new URL(`/checkout/${encodeURIComponent(brand.slug)}`, origin);
  returnUrl.searchParams.set("receipt", receiptToken);
  const refs = [...new Set(cart.items.map(i => i.personalizationRef).filter((v): v is string => Boolean(v)))];
  const context = await encryptBlob(brand.id, "payment-context", {
    email: input.email,
    quote: { draftInput: quote.draftInput, totals: quote.totals },
    personalizationRefs: refs,
  });
  const cartHash = await sha256Hex(JSON.stringify({ email: input.email, address: input.shippingAddress, priority: input.priority, items: cart.items }));
  const fingerprint = await sha256Hex(JSON.stringify([shopify.domain, whop.companyId, quote.totals.totalCents, cartHash]));
  const attemptId = `attempt_${crypto.randomUUID()}`;
  const now = Date.now();
  let attempt = await rpc<AnyObject>("limitless_checkout_payment_prepare", {
    p_brand_id: brand.id,
    p_key: key,
    p_fingerprint: fingerprint,
    p_attempt: {
      id: attemptId,
      brandId: brand.id,
      fingerprint,
      shopifyDomain: shopify.domain,
      whopCompanyId: whop.companyId,
      totalCents: quote.totals.totalCents,
      currency: "USD",
      expiresAt: now + ATTEMPT_TTL_MS,
      state: "prepared",
      runtimeVersion: 3,
      contextIv: context.iv,
      contextCiphertext: context.ciphertext,
    },
  });
  if (attempt.runtimeVersion !== 3) throw new HttpError(409, "This payment reference belongs to an older checkout. Start again.");
  if (refs.length) await rpc("limitless_checkout_claim_personalizations", { p_brand_id: brand.id, p_refs: refs, p_attempt_id: String(attempt.id) });
  const saved = await paymentContext(brand.id, attempt);
  const binding = { attemptId: String(attempt.id), email: saved.email, expiresAt: Number(attempt.expiresAt), quote: saved.quote };
  if (attempt.state === "prepared") {
    attempt = await rpc("limitless_checkout_payment_begin_draft", { p_brand_id: brand.id, p_attempt_id: String(attempt.id), p_now_ms: Date.now() });
    const draft = await createDraft(shopify, binding);
    attempt = await rpc("limitless_checkout_payment_bind_draft", { p_brand_id: brand.id, p_attempt_id: String(attempt.id), p_draft_id: String(draft.id) });
  } else if (attempt.state === "draft_pending") {
    const draft = await recoverDraft(shopify, binding);
    attempt = await rpc("limitless_checkout_payment_bind_draft", { p_brand_id: brand.id, p_attempt_id: String(attempt.id), p_draft_id: String(draft.id) });
  }
  if (attempt.state === "draft_ready") {
    if (Number(attempt.expiresAt) <= Date.now()) throw new HttpError(409, "Quote expired before payment creation.");
    const checkout = await createWhopCheckout(whop, { attemptId: String(attempt.id), totalCents: Number(attempt.totalCents), returnUrl: returnUrl.toString() });
    attempt = await rpc("limitless_checkout_payment_bind_checkout", {
      p_brand_id: brand.id,
      p_attempt_id: String(attempt.id),
      p_checkout_id: checkout.checkoutId,
      p_purchase_url: checkout.purchaseUrl,
      p_now_ms: Date.now(),
    });
  }
  if (attempt.state !== "checkout_ready" || Number(attempt.expiresAt) <= Date.now()) throw new HttpError(409, "This payment attempt cannot start another payment.");
  const embed = embedded(attempt);
  return json({ ...embed, returnUrl: returnUrl.toString(), totalCents: Number(attempt.totalCents), currency: "USD", expiresAt: Number(attempt.expiresAt) }, 201);
}
async function actionStatus(req: Request, payload: AnyObject) {
  await rateLimit(req, "status", 240, 60000);
  const brand = await brandBySlug(text(payload.slug, 100));
  const token = text(payload.receipt, 5000);
  const receipt = await decryptToken<ReceiptPayload>(brand.id, "customer-receipt", token);
  const now = Date.now();
  if (receipt.version !== 3 || receipt.brandId !== brand.id || receipt.slug !== brand.slug || receipt.expiresAt <= now || receipt.issuedAt > now + 60000 || receipt.expiresAt - receipt.issuedAt > RECEIPT_TTL_MS) {
    throw new HttpError(410, "This payment confirmation link has expired.");
  }
  const attempt = await rpc<AnyObject | null>("limitless_checkout_payment_get_by_key", { p_brand_id: brand.id, p_key: receipt.key });
  if (!attempt) throw new HttpError(404, "Payment attempt not found.");
  let status = "awaiting_payment";
  if (attempt.state === "completed") status = "confirmed";
  else if (attempt.state === "review") status = "review";
  else if (attempt.state === "paid") status = "processing";
  else if (Number(attempt.expiresAt) <= now) status = "expired";
  return json({ status, totalCents: Number(attempt.totalCents), currency: "USD", expiresAt: Number(attempt.expiresAt) });
}
async function actionHealth() {
  const gates = await runtimeConfig();
  return json({ runtime: "v3-bundles", paymentAcceptanceEnabled: gates.acceptance, publicPaymentEnabled: gates.public });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let payload: AnyObject;
  try {
    payload = await req.json() as AnyObject;
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  try {
    switch (payload.action) {
      case "cart-start": return await actionCartStart(req, payload);
      case "view": return await actionView(req, payload);
      case "quote": return await actionQuote(req, payload);
      case "payment-start": return await actionPaymentStart(req, payload);
      case "status": return await actionStatus(req, payload);
      case "health": return await actionHealth();
      default: throw new HttpError(404, "Checkout action not found.");
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("checkout-runtime", error);
    return json({ error: "Checkout service is temporarily unavailable." }, 503);
  }
});
