import { z } from "zod";
import type { Brand } from "../types";
import { checkoutExperience } from "../checkout";
import { CHECKOUT_CURRENCY } from "../markets";
import { HttpError } from "./errors";
import { bagCents, moneyBag, paymentQuoteInput } from "./payment-quote";
import { shopifyGraphql, verifyShopify, type ShopifyCredentials } from "./providers";

export const launchQuoteInput = paymentQuoteInput.omit({ shippingRateHandle: true }).extend({ priority: z.boolean().default(false) }).strict();
const variantId = z.string().regex(/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/);
const variantsResponse = z.object({ nodes: z.array(z.object({
  id: variantId, availableForSale: z.boolean(), sellableOnlineQuantity: z.number().int(),
  inventoryPolicy: z.enum(["DENY", "CONTINUE"]), inventoryItem: z.object({ tracked: z.boolean(), requiresShipping: z.boolean() }),
  requiresComponents: z.boolean(), product: z.object({ status: z.enum(["ACTIVE", "ARCHIVED", "DRAFT"]), isGiftCard: z.boolean(), requiresSellingPlan: z.boolean() }),
}).nullable()) });
const responseSchema = z.object({ draftOrderCalculate: z.object({
  userErrors: z.array(z.object({ message: z.string() })),
  calculatedDraftOrder: z.object({
    subtotalPriceSet: moneyBag, totalShippingPriceSet: moneyBag, totalTaxSet: moneyBag,
    totalDiscountsSet: moneyBag, totalPriceSet: moneyBag, taxesIncluded: z.boolean(),
    shippingLine: z.object({ title: z.string(), shippingRateHandle: z.string().nullable() }).nullable(),
    warnings: z.array(z.object({ errorCode: z.string(), field: z.string(), message: z.string() })),
    lineItems: z.array(z.object({
      variant: z.object({ id: variantId }).nullable(), quantity: z.number().int().positive(),
      custom: z.boolean(), title: z.string(), requiresShipping: z.boolean(), taxable: z.boolean(),
      originalUnitPriceSet: moneyBag, components: z.array(z.object({ quantity: z.number().int().positive() })),
    })),
  }).nullable(),
}) });
const bagFields = "shopMoney { amount currencyCode } presentmentMoney { amount currencyCode }";
const query = `mutation LimitlessLaunchPricing($input: DraftOrderInput!) {
  draftOrderCalculate(input: $input) {
    userErrors { message }
    calculatedDraftOrder {
      subtotalPriceSet { ${bagFields} } totalShippingPriceSet { ${bagFields} }
      totalTaxSet { ${bagFields} } totalDiscountsSet { ${bagFields} } totalPriceSet { ${bagFields} }
      taxesIncluded shippingLine { title shippingRateHandle } warnings { errorCode field message }
      lineItems { variant { id } quantity custom title requiresShipping taxable
        originalUnitPriceSet { ${bagFields} } components { quantity } }
    }
  }
}`;

// Snapshot only. Reservation and durable quote binding must precede payment creation.
export async function calculateLaunchQuote(brand: Brand, credentials: ShopifyCredentials, input: unknown) {
  const request = launchQuoteInput.parse(input);
  if (brand.shopify.status !== "verified" || brand.shopify.account !== credentials.domain) throw new HttpError(409, "Verify this brand's Shopify connection first.");
  if (brand.shippingPrice !== 0 || brand.freeShippingThreshold !== 0) throw new HttpError(409, "This launch calculation requires the saved free standard shipping policy.");
  const experience = checkoutExperience(brand);
  if (request.priority && !experience.priorityEnabled) throw new HttpError(422, "Priority processing is not available.");
  const priorityCents = request.priority ? Math.round(experience.priorityPrice * 100) : 0;
  if (request.priority && (!Number.isSafeInteger(priorityCents) || priorityCents !== 499)) throw new HttpError(409, "This launch calculation requires the saved $4.99 priority processing price.");
  const lineItems = request.items.map(item => {
    const product = brand.products.find(product => product.id === item.productId);
    if (!product?.available || !variantId.safeParse(product.variantId).success) throw new HttpError(422, "Choose available imported Shopify variants from this brand.");
    return { variantId: product.variantId!, quantity: item.quantity };
  });
  if (new Set(lineItems.map(item => item.variantId)).size !== lineItems.length) throw new HttpError(422, "Duplicate variants are not supported.");
  await verifyShopify(credentials, ["write_draft_orders"], "USD");
  const variants = variantsResponse.safeParse(await shopifyGraphql(credentials, `query LimitlessLaunchAvailability($ids: [ID!]!) {
    nodes(ids: $ids) { ... on ProductVariant { id availableForSale sellableOnlineQuantity inventoryPolicy
      inventoryItem { tracked requiresShipping } requiresComponents product { status isGiftCard requiresSellingPlan } } }
  }`, { ids: lineItems.map(item => item.variantId) }));
  if (!variants.success) throw new HttpError(502, "Shopify returned incomplete availability information.");
  const nodes = variants.data.nodes;
  if (nodes.length !== lineItems.length || new Set(nodes.map(node => node?.id)).size !== lineItems.length) throw new HttpError(422, "Shopify changed the requested variants.");
  for (const item of lineItems) {
    const node = nodes.find(node => node?.id === item.variantId);
    if (!node || node.product.status !== "ACTIVE" || !node.availableForSale || !node.inventoryItem.requiresShipping || node.requiresComponents || node.product.isGiftCard || node.product.requiresSellingPlan) throw new HttpError(422, "This cart contains unavailable or unsupported products. Only simple physical products are supported.");
    if (node.inventoryItem.tracked && node.inventoryPolicy === "DENY" && node.sellableOnlineQuantity < item.quantity) throw new HttpError(422, "The requested quantity is no longer available. Update the cart.");
  }
  const priorityLine = {
    title: "Priority processing", quantity: 1, requiresShipping: false, taxable: true,
    originalUnitPriceWithCurrency: { amount: "4.99", currencyCode: CHECKOUT_CURRENCY },
  };
  const parsed = responseSchema.safeParse(await shopifyGraphql(credentials, query, { input: {
    lineItems: [...lineItems, ...(request.priority ? [priorityLine] : [])],
    shippingAddress: request.shippingAddress, presentmentCurrencyCode: CHECKOUT_CURRENCY,
    acceptAutomaticDiscounts: false, allowDiscountCodesInCheckout: false, taxExempt: false,
    shippingLine: { title: "Free standard shipping", priceWithCurrency: { amount: "0.00", currencyCode: CHECKOUT_CURRENCY } },
  } }));
  if (!parsed.success) throw new HttpError(502, "Shopify returned an incomplete or unsupported launch calculation.");
  const { calculatedDraftOrder: draft, userErrors } = parsed.data.draftOrderCalculate;
  if (userErrors.length || !draft) throw new HttpError(422, "Shopify could not calculate this cart. Check the address and draft-order access.");
  if (draft.warnings.length) throw new HttpError(422, "Shopify returned pricing warnings. Resolve the cart or destination configuration before proceeding.");
  const merchandise = draft.lineItems.filter(item => item.variant !== null);
  const custom = draft.lineItems.filter(item => item.variant === null);
  if (merchandise.length !== lineItems.length || new Set(merchandise.map(item => item.variant!.id)).size !== lineItems.length || merchandise.some(item => item.custom || !item.requiresShipping || item.components.length || !lineItems.some(expected => expected.variantId === item.variant!.id && expected.quantity === item.quantity))) throw new HttpError(422, "Shopify changed the cart or returned unsupported items.");
  if (custom.length !== (request.priority ? 1 : 0) || custom.some(item => !item.custom || item.title !== priorityLine.title || item.quantity !== 1 || item.requiresShipping || !item.taxable || item.components.length || bagCents(item.originalUnitPriceSet) !== priorityCents)) throw new HttpError(422, "Shopify changed the priority processing charge.");
  const subtotalCents = merchandise.reduce((sum, item) => sum + bagCents(item.originalUnitPriceSet) * item.quantity, 0);
  const shippingCents = bagCents(draft.totalShippingPriceSet);
  const taxCents = bagCents(draft.totalTaxSet);
  const discountCents = bagCents(draft.totalDiscountsSet);
  const totalCents = bagCents(draft.totalPriceSet);
  const expectedTotal = subtotalCents + priorityCents + (draft.taxesIncluded ? 0 : taxCents);
  if (!Number.isSafeInteger(subtotalCents) || !Number.isSafeInteger(expectedTotal) || shippingCents !== 0 || discountCents !== 0 || bagCents(draft.subtotalPriceSet) !== subtotalCents + priorityCents || totalCents !== expectedTotal || !draft.shippingLine || draft.shippingLine.title !== "Free standard shipping" || draft.shippingLine.shippingRateHandle !== null) throw new HttpError(422, "Shopify totals do not match the free shipping and priority processing policy.");
  return {
    mode: "diagnostic" as const, paymentReady: false as const, status: "calculated" as const,
    currency: CHECKOUT_CURRENCY, calculatedAt: new Date().toISOString(),
    totals: { subtotalCents, priorityCents, shippingCents, taxCents, discountCents, totalCents, taxesIncluded: draft.taxesIncluded },
    limitations: ["Current calculation only; inventory is not reserved and this is not a payable quote.", "Priority processing is sent to Shopify as a taxable service; store-specific tax acceptance is still required.", "No payment or Shopify order is created."],
  };
}
