import { z } from "zod";
import type { Brand } from "../types";
import { CHECKOUT_CURRENCY, LAUNCH_COUNTRY_CODES } from "../markets";
import { HttpError } from "./errors";
import { shopifyGraphql, verifyShopify, type ShopifyCredentials } from "./providers";

const text = (max: number) => z.string().trim().min(1).max(max);
const shippingHandle = z.string().min(1).max(2000);
const postalPatterns = {
  US: /^\d{5}(?:-\d{4})?$/,
  CA: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/,
  GB: /^(?:GIR ?0AA|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2})$/,
  NZ: /^\d{4}$/,
  AU: /^\d{4}$/,
};
const shippingAddress = z.object({
  firstName: text(80), lastName: text(80), address1: text(200),
  address2: text(200).optional(), city: text(100),
  provinceCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}$/).optional(),
  zip: text(30).toUpperCase(), countryCode: z.enum(LAUNCH_COUNTRY_CODES),
}).strict().superRefine((address, ctx) => {
  if (!postalPatterns[address.countryCode].test(address.zip)) ctx.addIssue({ code: "custom", path: ["zip"], message: "Use a postal code matching the selected country." });
  if (["US", "CA"].includes(address.countryCode) && !/^[A-Z]{2}$/.test(address.provinceCode ?? "")) ctx.addIssue({ code: "custom", path: ["provinceCode"], message: "A two-letter state or province code is required." });
  if (address.countryCode === "AU" && !/^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/.test(address.provinceCode ?? "")) ctx.addIssue({ code: "custom", path: ["provinceCode"], message: "Select an Australian state or territory." });
});
export const paymentQuoteInput = z.object({
  items: z.array(z.object({
    productId: text(200), quantity: z.number().int().min(1).max(20),
  }).strict()).min(1).max(30).refine(items => new Set(items.map(item => item.productId)).size === items.length, "Duplicate products are not allowed"),
  shippingAddress,
  shippingRateHandle: shippingHandle.optional(),
}).strict();

const money = z.object({ amount: z.string(), currencyCode: z.literal(CHECKOUT_CURRENCY) });
const moneyBag = z.object({ shopMoney: money, presentmentMoney: money });
const variantId = z.string().regex(/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/);
const calculationResponse = z.object({
  draftOrderCalculate: z.object({
    userErrors: z.array(z.object({ message: z.string() })),
    calculatedDraftOrder: z.object({
      subtotalPriceSet: moneyBag, totalShippingPriceSet: moneyBag,
      totalTaxSet: moneyBag, totalDiscountsSet: moneyBag, totalPriceSet: moneyBag,
      taxesIncluded: z.boolean(),
      availableShippingRates: z.array(z.object({ handle: shippingHandle, title: text(300), price: money })),
      shippingLine: z.object({ shippingRateHandle: z.string().nullable() }).nullable(),
      lineItems: z.array(z.object({ variant: z.object({ id: variantId }).nullable(), quantity: z.number().int().positive(), requiresShipping: z.boolean(), components: z.array(z.object({ quantity: z.number().int().positive() })) })),
      warnings: z.array(z.object({ errorCode: z.string(), field: z.string(), message: z.string() })),
    }).nullable(),
  }),
});

const calculationQuery = `mutation LimitlessPaymentPreflight($input: DraftOrderInput!) {
  draftOrderCalculate(input: $input) {
    userErrors { message }
    calculatedDraftOrder {
      subtotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalDiscountsSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      taxesIncluded
      availableShippingRates { handle title price { amount currencyCode } }
      shippingLine { shippingRateHandle }
      lineItems { variant { id } quantity requiresShipping components { quantity } }
      warnings { errorCode field message }
    }
  }
}`;

export function usdCents(amount: string): number {
  if (!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) throw new HttpError(502, "Shopify returned an unsupported USD amount.");
  const [whole, fraction = ""] = amount.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new HttpError(502, "Shopify returned an unsupported USD amount.");
  return cents;
}

function bagCents(bag: z.infer<typeof moneyBag>) {
  const cents = usdCents(bag.presentmentMoney.amount);
  if (usdCents(bag.shopMoney.amount) !== cents) throw new HttpError(422, "Different shop and presentment prices are not supported by this preflight.");
  return cents;
}

export async function calculatePaymentQuote(brand: Brand, credentials: ShopifyCredentials, input: unknown) {
  const request = paymentQuoteInput.parse(input);
  if (brand.shopify.status !== "verified" || brand.shopify.account !== credentials.domain) throw new HttpError(409, "Verify this brand's Shopify connection first.");
  const lineItems = request.items.map(item => {
    const product = brand.products.find(product => product.id === item.productId);
    if (!product?.available || !variantId.safeParse(product.variantId).success) throw new HttpError(422, "Choose available imported Shopify variants from this brand, not demo products.");
    return { variantId: product.variantId!, quantity: item.quantity };
  });
  if (new Set(lineItems.map(item => item.variantId)).size !== lineItems.length) throw new HttpError(422, "Duplicate variants are not supported.");
  await verifyShopify(credentials, ["write_draft_orders"]);

  const draftInput = {
    lineItems, shippingAddress: request.shippingAddress, presentmentCurrencyCode: CHECKOUT_CURRENCY,
    acceptAutomaticDiscounts: false, taxExempt: false,
  };
  async function calculate(shippingRateHandle?: string) {
    const data = await shopifyGraphql(credentials, calculationQuery, {
      input: { ...draftInput, ...(shippingRateHandle ? { shippingLine: { shippingRateHandle } } : {}) },
    });
    const parsed = calculationResponse.safeParse(data);
    if (!parsed.success) throw new HttpError(502, "Shopify returned an incomplete or unsupported pricing calculation. No payment can be started.");
    const { userErrors, calculatedDraftOrder: draft } = parsed.data.draftOrderCalculate;
    if (userErrors.length || !draft) throw new HttpError(422, "Shopify could not calculate this cart. Check the address, variants, and draft-order access.");
    if (draft.lineItems.length !== lineItems.length || draft.lineItems.some(item => !item.requiresShipping || item.components.length > 0 || !lineItems.some(expected => expected.variantId === item.variant?.id && expected.quantity === item.quantity)) || new Set(draft.lineItems.map(item => item.variant?.id)).size !== lineItems.length) {
      throw new HttpError(422, "Shopify changed the cart or returned unsupported items. This preflight supports simple physical-product variants only.");
    }
    const rates = draft.availableShippingRates.map(rate => ({ handle: rate.handle, title: rate.title, amountCents: usdCents(rate.price.amount) }));
    if (new Set(rates.map(rate => rate.handle)).size !== rates.length) throw new HttpError(502, "Shopify returned ambiguous shipping rates.");
    const totals = {
      subtotalCents: bagCents(draft.subtotalPriceSet), shippingCents: bagCents(draft.totalShippingPriceSet),
      taxCents: bagCents(draft.totalTaxSet), discountCents: bagCents(draft.totalDiscountsSet),
      totalCents: bagCents(draft.totalPriceSet), taxesIncluded: draft.taxesIncluded,
    };
    return { draft, rates, totals };
  }

  // Discover rates afresh; never turn a browser-supplied shipping price into a custom rate.
  let result = await calculate();
  if (request.shippingRateHandle && !result.draft.warnings.length) {
    if (!result.rates.some(rate => rate.handle === request.shippingRateHandle)) throw new HttpError(422, "The selected shipping rate is no longer available. Request rates again.");
    result = await calculate(request.shippingRateHandle);
    if (result.draft.shippingLine?.shippingRateHandle !== request.shippingRateHandle) throw new HttpError(422, "Shopify did not apply the selected shipping rate. Request rates again.");
  }
  const blockers = [
    ...(result.draft.warnings.length ? ["shopify_warnings"] : []),
    ...(!request.shippingRateHandle && !result.rates.length ? ["no_shipping_rates"] : []),
  ];
  return {
    mode: "diagnostic" as const, paymentReady: false as const, currency: CHECKOUT_CURRENCY,
    status: blockers.length ? "blocked" : request.shippingRateHandle ? "calculated" : "shipping_selection_required",
    calculatedAt: new Date().toISOString(),
    shippingRates: result.rates, selectedShippingRateHandle: result.draft.shippingLine?.shippingRateHandle ?? null,
    totals: result.totals, warnings: result.draft.warnings, blockers,
    limitations: [
      "Diagnostic calculation only; not a reserved or payable quote.",
      "Guest US/CA/GB/NZ/AU simple physical products in USD only; no discounts, personalization, bundles, or customer exemptions.",
      "Inventory is not reserved. Shopify Checkout and Markets parity require store-specific verification.",
      "Live Whop payments and Shopify order synchronization remain disabled.",
    ],
  };
}
