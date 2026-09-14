import { z } from "zod";
import type { Store } from "./store";
import { readCartSession } from "./cart-session";
import { calculateLaunchQuote } from "./launch-quote";
import { paymentQuoteInput } from "./payment-quote";
import { PaymentAttempts } from "./payment-attempts";
import { sameShopifyCredentials, type ShopifyCredentials } from "./providers";
import { decrypt, encrypt, HttpError } from "./security";
import { startPayment } from "./payment-service";

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const receiptPayload = z.object({
  version: z.literal(1),
  brandId: z.string().min(1).max(200),
  slug: z.string().min(1).max(200),
  key: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
}).strict();

export const customerCheckoutInput = paymentQuoteInput.pick({ shippingAddress: true }).extend({
  cartToken: z.string().min(20).max(16_000),
  email: z.email().max(254),
  priority: z.boolean().default(false),
}).strict();

export const customerPaymentStartInput = customerCheckoutInput.extend({
  confirmedTotalCents: z.number().int().min(50).max(10_000_000),
}).strict();

type CustomerCheckoutInput = z.infer<typeof customerCheckoutInput>;

export function publicPaymentEnabled() {
  return process.env.PUBLIC_PAYMENT_ENABLED === "true" && process.env.PAYMENT_ACCEPTANCE_ENABLED === "true";
}

function receiptContext(brandId: string) {
  return `customer-payment-receipt:${brandId}:v1`;
}

export function createCustomerReceipt(brand: { id: string; slug: string }, key: string, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(422, "Invalid checkout reference.");
  const payload = { version: 1 as const, brandId: brand.id, slug: brand.slug, key, issuedAt: now, expiresAt: now + RECEIPT_TTL_MS };
  return encrypt(JSON.stringify(payload), receiptContext(brand.id));
}

function readCustomerReceipt(brand: { id: string; slug: string }, token: string, now = Date.now()) {
  if (!token || token.length > 4000) throw new HttpError(422, "This payment confirmation link is invalid.");
  let raw: unknown;
  try { raw = JSON.parse(decrypt(token, receiptContext(brand.id))); }
  catch { throw new HttpError(422, "This payment confirmation link is invalid."); }
  const parsed = receiptPayload.safeParse(raw);
  if (!parsed.success || parsed.data.brandId !== brand.id || parsed.data.slug !== brand.slug) throw new HttpError(422, "This payment confirmation link does not belong to this store.");
  if (parsed.data.expiresAt <= now || parsed.data.issuedAt > now + 60_000 || parsed.data.expiresAt - parsed.data.issuedAt > RECEIPT_TTL_MS) throw new HttpError(410, "This payment confirmation link has expired.");
  return parsed.data;
}

async function loadCustomerContext(db: Store, slug: string, input: CustomerCheckoutInput) {
  const brand = await db.brand(slug, true);
  const cart = readCartSession(brand, input.cartToken);
  const shopify = await db.credential<ShopifyCredentials>(brand.id, "shopify");
  if (brand.shopify.status !== "verified" || brand.shopify.account !== shopify.domain) throw new HttpError(409, "This store is not ready to calculate checkout yet.");
  return { input, brand, cart, shopify };
}

export async function quoteCustomerCheckout(db: Store, slug: string, raw: unknown) {
  const input = customerCheckoutInput.parse(raw);
  const { brand, cart, shopify } = await loadCustomerContext(db, slug, input);
  const quote = await calculateLaunchQuote(brand, shopify, {
    items: cart.items,
    shippingAddress: input.shippingAddress,
    priority: input.priority,
  });
  const currentShopify = await db.credential<ShopifyCredentials>(brand.id, "shopify");
  const currentBrand = await db.brand(brand.id);
  if (!sameShopifyCredentials(shopify, currentShopify) || JSON.stringify(currentBrand) !== JSON.stringify(brand)) throw new HttpError(409, "Store settings changed during checkout. Review the total again.");
  return {
    ...quote,
    paymentEnabled: publicPaymentEnabled() && brand.status === "live" && brand.mode === "live" && brand.whop.status === "verified",
  };
}

export async function startCustomerCheckoutPayment(db: Store, slug: string, raw: unknown, key: string, origin: string) {
  if (!publicPaymentEnabled()) throw new HttpError(409, "Customer payments are not enabled yet.");
  const input = customerPaymentStartInput.parse(raw);
  const { brand, cart } = await loadCustomerContext(db, slug, input);
  if (brand.status !== "live" || brand.mode !== "live") throw new HttpError(409, "This checkout is not published for live payment yet.");
  const receipt = createCustomerReceipt(brand, key);
  const returnUrl = new URL(`/checkout/${encodeURIComponent(brand.slug)}`, origin);
  returnUrl.searchParams.set("receipt", receipt);
  const started = await startPayment(db, brand.id, {
    email: input.email,
    items: cart.items,
    shippingAddress: input.shippingAddress,
    priority: input.priority,
  }, key, returnUrl.toString(), input.confirmedTotalCents);
  return {
    planId: started.planId,
    sessionId: started.sessionId,
    returnUrl: returnUrl.toString(),
    totalCents: started.totalCents,
    currency: started.currency,
    expiresAt: started.expiresAt,
  };
}

export async function customerPaymentStatus(db: Store, slug: string, receiptToken: string, now = Date.now()) {
  const brand = await db.brand(slug, true);
  const receipt = readCustomerReceipt(brand, receiptToken, now);
  const attempt = await new PaymentAttempts(db.database).getByKey(brand.id, receipt.key);
  let status: "awaiting_payment" | "processing" | "confirmed" | "review" | "expired";
  if (attempt.state === "completed") status = "confirmed";
  else if (attempt.state === "review") status = "review";
  else if (attempt.state === "paid") status = "processing";
  else if (attempt.expiresAt <= now) status = "expired";
  else status = "awaiting_payment";
  return { status, totalCents: attempt.totalCents, currency: attempt.currency, expiresAt: attempt.expiresAt };
}
