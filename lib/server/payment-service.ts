import { z } from "zod";
import { createHash } from "node:crypto";
import type { Store } from "./store";
import { encrypt, decrypt, HttpError } from "./security";
import { prepareLaunchQuote, launchQuoteInput } from "./launch-quote";
import { PaymentAttempts, type PaymentAttempt } from "./payment-attempts";
import { createShopifyDraft, recoverShopifyDraft, completeShopifyDraft, type DraftBinding } from "./shopify-drafts";
import { createWhopCheckout, retrieveVerifiedWhopPayment, sameShopifyCredentials, type ShopifyCredentials, type WhopCredentials } from "./providers";

const inputSchema = launchQuoteInput.extend({ email: z.email().max(254) }).strict();
type Context = { email: string; quote: Awaited<ReturnType<typeof prepareLaunchQuote>> };
function context(attempt: PaymentAttempt): DraftBinding {
  if (!attempt.encryptedContext) throw new HttpError(409, "Payment attempt has no saved quote.");
  const value: Context = JSON.parse(decrypt(attempt.encryptedContext, `payment:${attempt.brandId}`));
  return { ...value, attemptId: attempt.id, expiresAt: attempt.expiresAt };
}
async function connections(db: Store, brandId: string, attempt?: PaymentAttempt) {
  const brand = await db.brand(brandId);
  const shopify = await db.credential<ShopifyCredentials>(brandId, "shopify");
  const whop = await db.credential<WhopCredentials>(brandId, "whop");
  if (brand.shopify.status !== "verified" || brand.whop.status !== "verified" || brand.shopify.account !== shopify.domain || brand.whop.account !== whop.companyId || attempt && (attempt.shopifyDomain !== shopify.domain || attempt.whopCompanyId !== whop.companyId)) throw new HttpError(409, "Payment provider accounts changed. Review this attempt.");
  return { brand, shopify, whop };
}

// Admin acceptance only until sandbox, callback delivery and storefront tests pass.
export async function startPayment(db: Store, brandId: string, raw: unknown, key: string, returnUrl: string) {
  if (process.env.PAYMENT_ACCEPTANCE_ENABLED !== "true") throw new HttpError(409, "Payment acceptance testing is not enabled.");
  const input = inputSchema.parse(raw);
  const { brand, shopify, whop } = await connections(db, brandId);
  if (!whop.webhookSecret) throw new HttpError(409, "Configure and verify this brand's Whop webhook before accepting payments.");
  const { email, ...cart } = input;
  const quote = await prepareLaunchQuote(brand, shopify, cart);
  const current = await connections(db, brandId);
  if (!sameShopifyCredentials(shopify, current.shopify) || whop.apiKey !== current.whop.apiKey || JSON.stringify(brand) !== JSON.stringify(current.brand)) throw new HttpError(409, "Store settings changed during pricing.");
  const ledger = new PaymentAttempts(db.database);
  let attempt = await ledger.prepare({ brandId, key, shopifyDomain: shopify.domain, whopCompanyId: whop.companyId, totalCents: quote.totals.totalCents,
    cartFingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"), encryptedContext: encrypt(JSON.stringify({ email, quote }), `payment:${brandId}`) });
  const binding = context(attempt);
  if (attempt.state === "prepared") {
    attempt = await ledger.beginDraft(brandId, attempt.id);
    const draft = await createShopifyDraft(shopify, binding);
    attempt = await ledger.bindDraft(brandId, attempt.id, draft.id);
  } else if (attempt.state === "draft_pending") {
    const draft = await recoverShopifyDraft(shopify, binding);
    attempt = await ledger.bindDraft(brandId, attempt.id, draft.id);
  }
  if (attempt.state === "draft_ready") {
    if (attempt.expiresAt <= Date.now()) throw new HttpError(409, "Quote expired before payment creation.");
    const checkout = await createWhopCheckout(whop, { attemptId: attempt.id, totalCents: attempt.totalCents, returnUrl });
    attempt = await ledger.bindCheckout(brandId, attempt.id, checkout.checkoutConfigurationId, Date.now(), checkout.purchaseUrl);
  }
  if (attempt.state !== "checkout_ready" || attempt.expiresAt <= Date.now()) throw new HttpError(409, "This attempt cannot start another payment.");
  return { attemptId: attempt.id, purchaseUrl: attempt.purchaseUrl, totalCents: attempt.totalCents, currency: attempt.currency, expiresAt: attempt.expiresAt };
}

export async function reconcilePayment(db: Store, brandId: string, attemptId: string, paymentId: string) {
  const ledger = new PaymentAttempts(db.database);
  let attempt = await ledger.get(brandId, attemptId);
  const { shopify, whop } = await connections(db, brandId, attempt);
  if (!attempt.checkoutId) throw new HttpError(409, "Payment checkout is not bound.");
  await retrieveVerifiedWhopPayment(whop, { paymentId, attemptId, checkoutConfigurationId: attempt.checkoutId, totalCents: attempt.totalCents });
  attempt = await ledger.acceptVerifiedPayment(brandId, attemptId, paymentId);
  if (attempt.state === "completed" || attempt.state === "review") return { state: attempt.state, orderId: attempt.orderId };
  attempt = await ledger.claimCompletion(brandId, attemptId);
  const order = await completeShopifyDraft(shopify, context(attempt), attempt.draftId!);
  attempt = await ledger.complete(brandId, attemptId, order.id, attempt.completionLease!.token);
  return { state: attempt.state, orderId: attempt.orderId };
}

export function whopPaymentReference(event: { type: string; data: Record<string, unknown> }) {
  if (event.type !== "payment.succeeded") return null;
  const paymentId = event.data.id;
  const metadata = event.data.metadata;
  const attemptId = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).limitless_attempt_id : undefined;
  if (typeof paymentId !== "string" || !/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new HttpError(422, "Whop succeeded event has no valid payment ID.");
  if (typeof attemptId !== "string" || !/^attempt_[0-9a-f-]{36}$/.test(attemptId)) return null;
  return { paymentId, attemptId };
}
