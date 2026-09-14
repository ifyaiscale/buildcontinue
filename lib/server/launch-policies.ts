import { createHash } from "node:crypto";
import type { Brand } from "../types";
import type { Store } from "./store";
import { HttpError } from "./errors";

export const LAUNCH_POLICY_VERSION = 1;

type LaunchPolicyApproval = {
  version: 1;
  brandId: string;
  policyHash: string;
  approvedAt: string;
};

function metadataKey(brandId: string) {
  return `launch_policy_approval:${brandId}`;
}

function standardReturnPolicy() {
  return {
    returns: "Eligible non-personalized items may be requested for return within 30 days of delivery if unused and in their original condition. Damaged, defective, or incorrect items should be reported promptly so the order can be reviewed and corrected.",
    cancellations: "Cancellation is not guaranteed after fulfillment or production has started.",
  };
}

function personalizedReturnPolicy() {
  return {
    returns: "Because FaceJamas products are made from customer-supplied personalization, personalized items are final sale except where the item arrives damaged, defective, incorrect, or with a verified production error.",
    cancellations: "Personalized-order cancellation is not guaranteed once production has started.",
  };
}

export function launchPolicy(brand: Brand) {
  const personalized = brand.slug === "facejamas";
  const returns = personalized ? personalizedReturnPolicy() : standardReturnPolicy();
  return {
    version: LAUNCH_POLICY_VERSION,
    brandId: brand.id,
    brandSlug: brand.slug,
    support: {
      email: brand.supportEmail.trim(),
      statement: "Customer support requests must use the monitored support contact configured for this brand.",
    },
    shipping: {
      standard: "Free standard shipping under the current launch policy.",
      priority: "Optional $4.99 priority processing applies once per order when selected. Priority processing does not promise a faster carrier service or guaranteed delivery date.",
      taxes: "Applicable destination taxes and the authoritative USD order total are calculated at checkout by Shopify through Limitless Checkout.",
    },
    returns,
    privacy: personalized ? {
      general: "FaceJamas source photos are stored privately and are not placed in public cart or payment URLs.",
      abandonedUploadRetention: "Expired unclaimed FaceJamas source uploads are deleted after the 30-day upload receipt window.",
      orderedArtworkRetention: "Ordered FaceJamas source artwork is retained for fulfillment and replacement support for 90 days after order binding, then the private source file is deleted while non-image order/audit metadata may remain.",
    } : {
      general: "Checkout and order data are used to process the purchase and operate customer support. Payment-card entry is hosted by the configured payment provider rather than collected by the storefront.",
    },
    productSpecific: brand.slug === "cozyinfants" ? [
      "Cuddle Bears are positioned for supervised comfort and together-time, not as a medical treatment or infant sleep product.",
      "Final age, care, battery, and safety instructions must match the manufactured product and packaging.",
    ] : brand.slug === "chefings" ? [
      "Chefings ingredient compatibility, cleaning, materials, battery/power, blade, and safety claims must match the final manufactured product instructions.",
    ] : [
      "The browser photo preview confirms the selected source image; it is not represented as an exact manufactured print-placement render.",
      "The customer must confirm they have permission to use the uploaded image for a personalized product.",
    ],
  };
}

export function launchPolicyHash(brand: Brand) {
  return createHash("sha256").update(JSON.stringify(launchPolicy(brand))).digest("hex");
}

async function approval(db: Store, brandId: string): Promise<LaunchPolicyApproval | null> {
  const row = await db.database.get("SELECT value FROM metadata WHERE key = ?", metadataKey(brandId));
  if (!row || typeof row.value !== "string") return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<LaunchPolicyApproval>;
    if (parsed.version !== LAUNCH_POLICY_VERSION || parsed.brandId !== brandId || typeof parsed.policyHash !== "string" || typeof parsed.approvedAt !== "string") return null;
    return parsed as LaunchPolicyApproval;
  } catch {
    return null;
  }
}

export async function launchPolicyStatus(db: Store, brandId: string) {
  const brand = await db.brand(brandId);
  const policy = launchPolicy(brand);
  const policyHash = launchPolicyHash(brand);
  const saved = await approval(db, brand.id);
  const current = Boolean(saved && saved.policyHash === policyHash);
  return {
    policy,
    policyHash,
    approved: current,
    approvedAt: current ? saved!.approvedAt : null,
    supportContactConfigured: Boolean(brand.supportEmail.trim()),
  };
}

export async function approveLaunchPolicy(db: Store, brandId: string, acknowledged: boolean) {
  if (!acknowledged) throw new HttpError(422, "Confirm that you reviewed and approve the current launch policies.");
  return db.transaction(async () => {
    const brand = await db.brand(brandId);
    if (!brand.supportEmail.trim()) throw new HttpError(409, "Configure a real monitored support email before approving launch policies.");
    const record: LaunchPolicyApproval = {
      version: LAUNCH_POLICY_VERSION,
      brandId: brand.id,
      policyHash: launchPolicyHash(brand),
      approvedAt: new Date().toISOString(),
    };
    await db.database.run(
      "INSERT INTO metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      metadataKey(brand.id),
      JSON.stringify(record),
    );
    await db.addActivity(`${brand.name}: customer launch policies approved`, "brand", brand.id);
    return { approved: true, approvedAt: record.approvedAt, policyHash: record.policyHash };
  });
}
