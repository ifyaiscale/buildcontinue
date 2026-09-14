import { createHash } from "node:crypto";
import type { Brand } from "../types";
import type { Store } from "./store";
import { PaymentAttempts } from "./payment-attempts";
import type { ShopifyCredentials, WhopCredentials } from "./providers";
import { launchPolicyStatus } from "./launch-policies";
import { HttpError } from "./errors";

const ACCEPTANCE_VERSION = 1;
type AcceptanceRecord = {
  version: 1;
  brandId: string;
  attemptId: string;
  orderId: string;
  totalCents: number;
  shopifyDomain: string;
  whopCompanyId: string;
  launchFingerprint: string;
  acceptedAt: string;
};

function metadataKey(brandId: string) { return `launch_acceptance:${brandId}`; }

function launchFingerprint(brand: Brand) {
  const experience = brand.checkoutExperience;
  const products = brand.products
    .filter(product => product.available)
    .map(product => [product.id, product.variantId ?? "", product.price])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify({
    brandId: brand.id,
    domain: brand.domain,
    supportEmail: brand.supportEmail.trim().toLowerCase(),
    shopify: brand.shopify.account ?? "",
    whop: brand.whop.account ?? "",
    products,
    shippingPrice: brand.shippingPrice,
    freeShippingThreshold: brand.freeShippingThreshold,
    checkoutExperience: experience ? {
      priorityEnabled: experience.priorityEnabled,
      priorityPrice: experience.priorityPrice,
      priorityLabel: experience.priorityLabel,
      deliveryText: experience.deliveryText,
      returnsText: experience.returnsText,
    } : null,
  })).digest("hex");
}

async function acceptance(db: Store, brandId: string): Promise<AcceptanceRecord | null> {
  const row = await db.database.get("SELECT value FROM metadata WHERE key = ?", metadataKey(brandId));
  if (!row || typeof row.value !== "string") return null;
  try {
    const value = JSON.parse(row.value) as Partial<AcceptanceRecord>;
    if (value.version !== ACCEPTANCE_VERSION || value.brandId !== brandId || typeof value.attemptId !== "string" || typeof value.orderId !== "string" || typeof value.totalCents !== "number" || typeof value.shopifyDomain !== "string" || typeof value.whopCompanyId !== "string" || typeof value.launchFingerprint !== "string" || typeof value.acceptedAt !== "string") return null;
    return value as AcceptanceRecord;
  } catch { return null; }
}

async function providerChecks(db: Store, brand: Brand) {
  let shopify: ShopifyCredentials | null = null;
  let whop: WhopCredentials | null = null;
  try { shopify = await db.credential<ShopifyCredentials>(brand.id, "shopify"); } catch {}
  try { whop = await db.credential<WhopCredentials>(brand.id, "whop"); } catch {}
  return {
    shopify,
    whop,
    shopifyVerified: Boolean(shopify && brand.shopify.status === "verified" && brand.shopify.account === shopify.domain),
    whopVerified: Boolean(whop && brand.whop.status === "verified" && brand.whop.account === whop.companyId),
    webhookConfigured: Boolean(whop?.webhookSecret),
  };
}

function faceJamasMediaConfigured(brand: Brand) {
  if (brand.slug !== "facejamas") return true;
  const key = process.env.SUPABASE_PUBLIC_ANON_KEY?.trim();
  const endpoint = process.env.FACEJAMAS_ASSET_URL?.trim();
  if (!key || !endpoint) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && url.hostname === "ifwljlzrhfmviwhsjhpp.supabase.co" && url.pathname === "/functions/v1/facejamas-asset";
  } catch {
    return false;
  }
}

export async function launchReadiness(db: Store, brandId: string) {
  const brand = await db.brand(brandId);
  const providers = await providerChecks(db, brand);
  const policies = await launchPolicyStatus(db, brandId);
  const saved = await acceptance(db, brandId);
  let acceptedAttemptCurrent = false;
  if (saved && saved.launchFingerprint === launchFingerprint(brand) && saved.shopifyDomain === brand.shopify.account && saved.whopCompanyId === brand.whop.account) {
    try {
      const attempt = await new PaymentAttempts(db.database).get(brandId, saved.attemptId);
      acceptedAttemptCurrent = attempt.state === "completed" && attempt.orderId === saved.orderId && attempt.totalCents === saved.totalCents && attempt.shopifyDomain === saved.shopifyDomain && attempt.whopCompanyId === saved.whopCompanyId;
    } catch {}
  }
  const experience = brand.checkoutExperience;
  const checks = {
    paymentAcceptanceEnabled: process.env.PAYMENT_ACCEPTANCE_ENABLED === "true",
    publicPaymentEnabled: process.env.PUBLIC_PAYMENT_ENABLED === "true",
    storefrontDomainConfigured: Boolean(brand.domain),
    supportContactConfigured: policies.supportContactConfigured,
    launchPoliciesApproved: policies.approved,
    shopifyVerified: providers.shopifyVerified,
    whopVerified: providers.whopVerified,
    whopWebhookConfigured: providers.webhookConfigured,
    availableCatalog: brand.products.some(product => product.available && Boolean(product.variantId)),
    launchShippingPolicy: brand.shippingPrice === 0 && brand.freeShippingThreshold === 0 && Boolean(experience?.priorityEnabled) && experience?.priorityPrice === 4.99,
    faceJamasPrivateMediaConfigured: faceJamasMediaConfigured(brand),
    controlledAcceptanceCompleted: acceptedAttemptCurrent,
  };
  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    policy: {
      approved: policies.approved,
      approvedAt: policies.approvedAt,
      policyHash: policies.policyHash,
    },
    acceptance: saved && acceptedAttemptCurrent ? { attemptId: saved.attemptId, orderId: saved.orderId, totalCents: saved.totalCents, acceptedAt: saved.acceptedAt } : null,
  };
}

export async function recordLaunchAcceptance(db: Store, brandId: string, attemptId: string) {
  if (process.env.PAYMENT_ACCEPTANCE_ENABLED !== "true") throw new HttpError(409, "Payment acceptance testing is not enabled.");
  if (!/^attempt_[0-9a-f-]{36}$/.test(attemptId)) throw new HttpError(422, "Invalid payment attempt.");
  return db.transaction(async () => {
    const brand = await db.brand(brandId);
    const providers = await providerChecks(db, brand);
    const policies = await launchPolicyStatus(db, brandId);
    if (!brand.supportEmail.trim() || !policies.approved) throw new HttpError(409, "Configure customer support and approve the current launch policies before recording launch acceptance.");
    if (!providers.shopifyVerified || !providers.whopVerified || !providers.webhookConfigured) throw new HttpError(409, "Verify the current Shopify, Whop and webhook connections before recording launch acceptance.");
    if (!faceJamasMediaConfigured(brand)) throw new HttpError(409, "FaceJamas private fulfillment media access is not configured.");
    const attempt = await new PaymentAttempts(db.database).get(brandId, attemptId);
    if (attempt.state !== "completed" || !attempt.orderId) throw new HttpError(409, "Launch acceptance requires a completed verified payment and Shopify order.");
    if (attempt.shopifyDomain !== brand.shopify.account || attempt.whopCompanyId !== brand.whop.account) throw new HttpError(409, "The accepted payment used different provider accounts. Run a new controlled acceptance purchase.");
    const record: AcceptanceRecord = {
      version: ACCEPTANCE_VERSION,
      brandId,
      attemptId,
      orderId: attempt.orderId,
      totalCents: attempt.totalCents,
      shopifyDomain: attempt.shopifyDomain,
      whopCompanyId: attempt.whop.account,
      launchFingerprint: launchFingerprint(brand),
      acceptedAt: new Date().toISOString(),
    };
    await db.database.run("INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", metadataKey(brandId), JSON.stringify(record));
    await db.addActivity(`${brand.name}: controlled payment acceptance recorded for launch`, "connection", brandId);
    return { attemptId: record.attemptId, orderId: record.orderId, totalCents: record.totalCents, acceptedAt: record.acceptedAt };
  });
}

export async function activateLiveCheckout(db: Store, brandId: string) {
  return db.transaction(async () => {
    const readiness = await launchReadiness(db, brandId);
    if (!readiness.ready) {
      const missing = Object.entries(readiness.checks).filter(([, ok]) => !ok).map(([name]) => name).join(", ");
      throw new HttpError(409, `Live checkout is not ready: ${missing || "launch requirements incomplete"}.`);
    }
    const brand = await db.brand(brandId);
    brand.status = "live";
    brand.mode = "live";
    await db.saveBrand(brand);
    await db.addActivity(`${brand.name} live checkout activated after controlled acceptance`, "brand", brandId);
    return brand;
  });
}
