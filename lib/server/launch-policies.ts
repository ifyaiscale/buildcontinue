import { createHash } from "node:crypto";
import type { Brand } from "../types";
import { checkoutExperience } from "../checkout";
import type { Store } from "./store";
import { HttpError } from "./errors";

export const LAUNCH_POLICY_VERSION = 2;

type LaunchPolicyApproval = {
  version: 2;
  brandId: string;
  policyHash: string;
  approvedAt: string;
};

function metadataKey(brandId: string) {
  return `launch_policy_approval:${brandId}`;
}

function standardReturnPolicy() {
  return {
    returns: "Eligible non-personalized items may be requested for return within 30 days of delivery. Returned items must be unused and in their original condition. Contact support before sending a return. Damaged, defective, or incorrect items will be reviewed for replacement, correction, or refund as appropriate.",
    refunds: "Approved refunds are issued to the original payment method after the return or issue has been reviewed. Optional priority-processing fees are not refundable after priority processing has begun.",
    cancellations: "Cancellation requests are accepted before fulfillment or production begins, but cancellation cannot be guaranteed once processing, fulfillment, or production has started.",
  };
}

function personalizedReturnPolicy() {
  return {
    returns: "Because FaceJamas products are made from customer-supplied personalization, personalized items are final sale except when the item arrives damaged, defective, incorrect, or with a verified production error.",
    refunds: "When a qualifying personalized-order issue is verified, FaceJamas may replace, correct, or refund the affected item as appropriate. Optional priority-processing fees are not refundable after priority processing has begun.",
    cancellations: "Personalized-order cancellation requests are accepted before production begins, but cancellation cannot be guaranteed once production has started.",
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
      statement: "Questions about an order, return, refund, cancellation, damage, or delivery should be sent to the monitored support contact for this brand.",
    },
    shipping: {
      standard: "Free standard shipping is included on every launch order. Delivery estimates are not guarantees and can vary by destination, fulfillment timing, carrier conditions, customs, or other circumstances outside the store's control.",
      priority: "Optional $4.99 priority processing applies once per order when selected. It moves the order into the priority-processing workflow but does not upgrade the carrier service or guarantee a delivery date.",
      taxes: "Applicable destination taxes and the authoritative USD order total are calculated at checkout using Shopify data through Limitless Checkout.",
    },
    returns,
    privacy: personalized ? {
      general: "Checkout and order information is used to process the purchase, provide support, and fulfill the order. Payment-card entry is hosted by the configured payment provider and raw card details are not collected by the storefront or Limitless Checkout.",
      sourcePhoto: "FaceJamas source photos are stored privately and are not placed in public cart, checkout, payment, or Shopify image URLs.",
      fulfillmentReference: "The Shopify order stores an opaque Personalization ID on the relevant line item. Authorized fulfillment staff or agents can use that reference through private fulfillment tooling to retrieve the matching source artwork; the source image itself remains private.",
      fulfillmentAccess: "Private artwork access must be authenticated and time-limited. Fulfillment providers receive only the order and artwork access needed to manufacture or ship the customer's personalized item.",
      abandonedUploadRetention: "Expired unclaimed FaceJamas source uploads are deleted after the 30-day upload receipt window.",
      orderedArtworkRetention: "Ordered FaceJamas source artwork is retained for fulfillment and replacement support for 90 days after it is bound to the Shopify order, then the private source file is deleted while non-image order and audit metadata may remain.",
    } : {
      general: "Checkout and order information is used to process the purchase, provide customer support, prevent fraud, and fulfill the order. Payment-card entry is hosted by the configured payment provider and raw card details are not collected by the storefront or Limitless Checkout.",
    },
    productSpecific: brand.slug === "cozyinfants" ? [
      "Cuddle Bears are comfort products for supervised use and are not marketed as medical treatment, anxiety treatment, or infant sleep products.",
      "Final age guidance, care instructions, battery information, warnings, and safety instructions must match the manufactured product and packaging.",
    ] : brand.slug === "chefings" ? [
      "Chefings ingredient compatibility, cleaning instructions, materials, battery or power details, blade handling, and safety claims must match the final manufactured product and instructions.",
    ] : [
      "The browser preview confirms the customer's selected source image. Normal manufacturing variation in print placement or color may occur unless a specific production proof is expressly provided.",
      "Customers must have permission to use the image they upload for a personalized product and must not upload content that infringes another person's rights.",
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

    const policy = launchPolicy(brand);
    const experience = checkoutExperience(brand);
    brand.checkoutExperience = {
      ...experience,
      deliveryText: "Free standard shipping on every order. Optional priority processing is $4.99 and does not change the carrier service.",
      returnsText: policy.returns.returns,
    };
    await db.saveBrand(brand);

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
    return { approved: true, approvedAt: record.approvedAt, policyHash: record.policyHash, brand };
  });
}
