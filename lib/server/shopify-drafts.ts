import { z } from "zod";
import { createHash } from "node:crypto";
import { bagCents, moneyBag } from "./payment-quote";
import { shopifyGraphql, type ShopifyCredentials } from "./providers";
import type { prepareLaunchQuote } from "./launch-quote";
import { HttpError } from "./errors";

type Quote = Awaited<ReturnType<typeof prepareLaunchQuote>>;
const attributes = z.array(z.object({ key: z.string(), value: z.string() }));
const draftSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/DraftOrder\/[1-9]\d*$/),
  status: z.enum(["OPEN", "INVOICE_SENT", "COMPLETED"]), email: z.string(),
  reserveInventoryUntil: z.string().nullable(), customAttributes: attributes,
  totalPriceSet: moneyBag, totalTaxSet: moneyBag, totalShippingPriceSet: moneyBag,
  shippingAddress: z.object({ firstName: z.string(), lastName: z.string(), address1: z.string(), address2: z.string().nullable(), city: z.string(), zip: z.string(), provinceCode: z.string().nullable(), countryCodeV2: z.string() }),
  lineItems: z.object({ nodes: z.array(z.object({ variant: z.object({ id: z.string() }).nullable(), quantity: z.number().int(), title: z.string(), customAttributes: attributes })), pageInfo: z.object({ hasNextPage: z.boolean() }) }),
  order: z.object({ id: z.string().regex(/^gid:\/\/shopify\/Order\/[1-9]\d*$/), displayFinancialStatus: z.string() }).nullable(),
});
const moneyFields = "shopMoney { amount currencyCode } presentmentMoney { amount currencyCode }";
const draftFields = `id status email reserveInventoryUntil customAttributes { key value }
 totalPriceSet { ${moneyFields} } totalTaxSet { ${moneyFields} } totalShippingPriceSet { ${moneyFields} }
 shippingAddress { firstName lastName address1 address2 city zip provinceCode countryCodeV2 }
 lineItems(first: 100) { nodes { variant { id } quantity title customAttributes { key value } } pageInfo { hasNextPage } }
 order { id displayFinancialStatus }`;

export type DraftBinding = { attemptId: string; email: string; expiresAt: number; quote: Quote };
export function draftTag(attemptId: string) { return `limitless_${createHash("sha256").update(attemptId).digest("hex")}`; }

function normalizedAttributes(values: Array<{ key: string; value: string }> | undefined) {
  return [...(values ?? [])].map(item => ({ key: item.key, value: item.value })).sort((a, b) => `${a.key}\u0000${a.value}`.localeCompare(`${b.key}\u0000${b.value}`));
}

function merchandiseKey(variantId: string, quantity: number, customAttributes?: Array<{ key: string; value: string }>) {
  return JSON.stringify({ variantId, quantity, customAttributes: normalizedAttributes(customAttributes) });
}

export function validateShopifyDraft(raw: unknown, binding: DraftBinding, requireReservation = true) {
  const parsed = draftSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(502, "Shopify returned an incomplete draft. Reconciliation is required.");
  const draft = parsed.data;
  const { quote } = binding;
  if (draft.email.toLowerCase() !== binding.email.toLowerCase() || !draft.customAttributes.some(a => a.key === "limitless_attempt_id" && a.value === binding.attemptId)) throw new HttpError(409, "Shopify draft customer or attempt does not match.");
  if (bagCents(draft.totalPriceSet) !== quote.totals.totalCents || bagCents(draft.totalTaxSet) !== quote.totals.taxCents || bagCents(draft.totalShippingPriceSet) !== 0) throw new HttpError(409, "Shopify draft totals changed. No payment can be fulfilled automatically.");
  const address = quote.draftInput.shippingAddress;
  for (const key of ["firstName", "lastName", "address1", "address2", "city", "zip", "provinceCode"] as const) {
    if ((draft.shippingAddress[key] ?? "") !== (address[key] ?? "")) throw new HttpError(409, "Shopify draft delivery address changed.");
  }
  if (draft.shippingAddress.countryCodeV2 !== address.countryCode) throw new HttpError(409, "Shopify draft destination changed.");

  const expected = quote.draftInput.lineItems.map(line => {
    if ("variantId" in line) {
      return merchandiseKey(line.variantId, line.quantity, "customAttributes" in line ? line.customAttributes : undefined);
    }
    return JSON.stringify({ priority: true, quantity: line.quantity, customAttributes: [] });
  }).sort();
  const actual = draft.lineItems.nodes.map(line => {
    if (line.variant) return merchandiseKey(line.variant.id, line.quantity, line.customAttributes);
    if (line.title === "Priority processing") return JSON.stringify({ priority: true, quantity: line.quantity, customAttributes: normalizedAttributes(line.customAttributes) });
    return "unsupported";
  }).sort();
  if (draft.lineItems.pageInfo.hasNextPage || JSON.stringify(expected) !== JSON.stringify(actual)) throw new HttpError(409, "Shopify draft items or personalization properties changed.");

  if (draft.status === "COMPLETED") {
    if (!draft.order || draft.order.displayFinancialStatus !== "PAID") throw new HttpError(409, "Shopify order is not marked paid.");
  } else {
    const reservationTime = draft.reserveInventoryUntil ? Date.parse(draft.reserveInventoryUntil) : Number.NaN;
    if (draft.order || requireReservation && (!Number.isFinite(reservationTime) || reservationTime < binding.expiresAt)) throw new HttpError(409, "Shopify did not retain the required inventory reservation.");
  }
  return draft;
}

export async function createShopifyDraft(credentials: ShopifyCredentials, binding: DraftBinding) {
  const result = await shopifyGraphql(credentials, `mutation LimitlessReserve($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { ${draftFields} } userErrors { message } } }`, {
    input: { ...binding.quote.draftInput, email: binding.email, reserveInventoryUntil: new Date(binding.expiresAt).toISOString(),
      tags: [draftTag(binding.attemptId)], customAttributes: [{ key: "limitless_attempt_id", value: binding.attemptId }], visibleToCustomer: false },
  });
  if (!result.draftOrderCreate || result.draftOrderCreate.userErrors?.length) throw new HttpError(422, "Shopify could not reserve this draft. Reconcile before retrying.");
  return validateShopifyDraft(result.draftOrderCreate.draftOrder, binding);
}

export async function recoverShopifyDraft(credentials: ShopifyCredentials, binding: DraftBinding) {
  const result = await shopifyGraphql(credentials, `query LimitlessRecover($query: String!) { draftOrders(first: 2, query: $query) { nodes { ${draftFields} } pageInfo { hasNextPage } } }`, { query: `tag:${draftTag(binding.attemptId)}` });
  const drafts = result.draftOrders;
  if (!drafts || !Array.isArray(drafts.nodes) || drafts.nodes.length !== 1 || drafts.pageInfo?.hasNextPage !== false) throw new HttpError(409, "Draft creation outcome remains uncertain. Do not create a replacement draft.");
  return validateShopifyDraft(drafts.nodes[0], binding);
}

export async function completeShopifyDraft(credentials: ShopifyCredentials, binding: DraftBinding, draftId: string) {
  if (!/^gid:\/\/shopify\/DraftOrder\/[1-9]\d*$/.test(draftId)) throw new HttpError(422, "Invalid Shopify draft.");
  const result = await shopifyGraphql(credentials, `query LimitlessDraft($id: ID!) { draftOrder(id: $id) { ${draftFields} } }`, { id: draftId });
  const draft = validateShopifyDraft(result.draftOrder, binding);
  if (draft.id !== draftId) throw new HttpError(409, "Shopify returned a different draft.");
  if (draft.order) return draft.order;
  if (Date.now() >= binding.expiresAt) throw new HttpError(409, "Inventory reservation expired. Paid order requires review.");
  const completed = await shopifyGraphql(credentials, `mutation LimitlessComplete($id: ID!) { draftOrderComplete(id: $id) { draftOrder { ${draftFields} } userErrors { message } } }`, { id: draftId });
  if (!completed.draftOrderComplete || completed.draftOrderComplete.userErrors?.length) throw new HttpError(409, "Shopify order completion needs reconciliation. Do not pay again.");
  const verified = validateShopifyDraft(completed.draftOrderComplete.draftOrder, binding, false);
  if (verified.id !== draftId || !verified.order) throw new HttpError(409, "Shopify completion is not confirmed.");
  return verified.order;
}
