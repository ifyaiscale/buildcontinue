import test from "node:test";
import assert from "node:assert/strict";
import { validateShopifyDraft, completeShopifyDraft, recoverShopifyDraft, type DraftBinding } from "../lib/server/shopify-drafts";

const bag = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" }, presentmentMoney: { amount, currencyCode: "USD" } });
const address = { firstName: "Test", lastName: "Buyer", address1: "1 Example St", city: "Portland", zip: "97201", provinceCode: "OR", countryCode: "US" as const };
function fixture() {
  const expiresAt = Date.now() + 900_000;
  const binding = { attemptId: "attempt_test", email: "test@example.com", expiresAt, quote: {
    draftInput: { shippingAddress: address, lineItems: [{ variantId: "gid://shopify/ProductVariant/1", quantity: 1 }] },
    totals: { totalCents: 1000, taxCents: 0 },
  } } as DraftBinding;
  const draft = { id: "gid://shopify/DraftOrder/1", status: "OPEN", email: binding.email, reserveInventoryUntil: new Date(expiresAt).toISOString(),
    customAttributes: [{ key: "limitless_attempt_id", value: binding.attemptId }], totalPriceSet: bag("10.00"), totalTaxSet: bag("0"), totalShippingPriceSet: bag("0"),
    shippingAddress: { ...address, countryCodeV2: "US", address2: null },
    lineItems: { nodes: [{ variant: { id: "gid://shopify/ProductVariant/1" }, quantity: 1, title: "Product", customAttributes: [] }], pageInfo: { hasNextPage: false } }, order: null as null | { id: string; displayFinancialStatus: string },
  };
  return { binding, draft };
}
test("draft validation rejects changed price, delivery, items, currency and missing reservation", () => {
  const { binding, draft } = fixture();
  assert.equal(validateShopifyDraft(draft, binding).id, draft.id);
  for (const changed of [
    { totalPriceSet: bag("9.99") }, { totalTaxSet: bag("1") }, { reserveInventoryUntil: null },
    { email: "other@example.com" }, { customAttributes: [] },
    { shippingAddress: { ...draft.shippingAddress, address1: "Changed" } },
    { lineItems: { ...draft.lineItems, pageInfo: { hasNextPage: true } } },
  ]) assert.throws(() => validateShopifyDraft({ ...draft, ...changed }, binding));
});
test("completion retries query the original draft and never complete an existing paid order twice", async () => {
  const { binding, draft } = fixture(); const oldFetch = globalThis.fetch;
  let mutations = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const query = JSON.parse(String(init?.body)).query;
      if (query.includes("mutation")) {
        mutations++; draft.status = "COMPLETED"; draft.order = { id: "gid://shopify/Order/1", displayFinancialStatus: "PAID" };
        return Response.json({ data: { draftOrderComplete: { draftOrder: draft, userErrors: [] } } });
      }
      return Response.json({ data: { draftOrder: draft } });
    };
    const credentials = { domain: "test.myshopify.com", accessToken: "synthetic" };
    assert.equal((await completeShopifyDraft(credentials, binding, draft.id)).id, "gid://shopify/Order/1");
    await completeShopifyDraft(credentials, binding, draft.id);
    assert.equal(mutations, 1);
    globalThis.fetch = async () => Response.json({ data: { draftOrders: { nodes: [], pageInfo: { hasNextPage: false } } } });
    await assert.rejects(recoverShopifyDraft(credentials, binding), /uncertain/);
  } finally { globalThis.fetch = oldFetch; }
});
