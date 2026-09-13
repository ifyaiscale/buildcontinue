import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../lib/server/store";
import { startPayment, reconcilePayment, whopPaymentReference } from "../lib/server/payment-service";
const bag = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" }, presentmentMoney: { amount, currencyCode: "USD" } });

test("payment service reserves, creates checkout, verifies and completes once; saved customer context is encrypted", async () => {
  const savedFetch = globalThis.fetch;
  const oldKey = process.env.CREDENTIAL_ENCRYPTION_KEY; const oldGate = process.env.PAYMENT_ACCEPTANCE_ENABLED;
  process.env.CREDENTIAL_ENCRYPTION_KEY = "ab".repeat(32);
  const db = new Store(":memory:");
  let creates = 0; let completes = 0; let checkoutCreates = 0;
  let persistedDraft: Record<string, unknown> = {};
  let attemptId = "";
  const variantId = "gid://shopify/ProductVariant/1";
  const request = { email: "buyer@example.com", items: [{ productId: "imported", quantity: 1 }], shippingAddress: { firstName: "Test", lastName: "Buyer", address1: "123 Example Street", city: "Portland", zip: "97201", provinceCode: "OR", countryCode: "US" } };
  try {
    delete process.env.PAYMENT_ACCEPTANCE_ENABLED;
    await assert.rejects(startPayment(db, "brand_1", request, "checkout_key", "https://example.com/"), /not enabled/);
    process.env.PAYMENT_ACCEPTANCE_ENABLED = "true";
    const brand = await db.brand("brand_1");
    brand.shippingPrice = 0; brand.freeShippingThreshold = 0;
    brand.shopify = { status: "verified", account: "test.myshopify.com" }; brand.whop = { status: "verified", account: "biz_test" };
    brand.products = [{ id: "imported", variantId, title: "Product", description: "", price: 10, available: true }];
    await db.saveBrand(brand);
    await db.setCredential(brand.id, "shopify", { domain: brand.shopify.account, accessToken: "synthetic" });
    await db.setCredential(brand.id, "whop", { companyId: "biz_test", apiKey: "synthetic", webhookSecret: "ws_synthetic" });
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("checkout_configurations")) {
        checkoutCreates++; const payload = JSON.parse(String(init?.body)); attemptId = payload.metadata.limitless_attempt_id;
        return Response.json({ id: "ch_test", company_id: "biz_test", mode: "payment", currency: "usd", purchase_url: "https://whop.com/checkout/plan_test?session=ch_test", metadata: payload.metadata, plan: { id: "plan_test", initial_price: 10, plan_type: "one_time" } });
      }
      if (String(url).includes("/payments/")) return Response.json({ id: "pay_test", company: { id: "biz_test" }, status: "paid", substatus: "succeeded", total: 10, currency: "usd", metadata: { limitless_attempt_id: attemptId }, checkout_configuration_id: "ch_test" });
      const { query, variables } = JSON.parse(String(init?.body));
      if (query.includes("currentAppInstallation")) return Response.json({ data: { shop: { name: "Test", myshopifyDomain: "test.myshopify.com", currencyCode: "USD" }, currentAppInstallation: { accessScopes: ["read_products", "read_inventory", "write_draft_orders"].map(handle => ({ handle })) } } });
      if (query.includes("LimitlessLaunchAvailability")) return Response.json({ data: { nodes: [{ id: variantId, availableForSale: true, sellableOnlineQuantity: 10, inventoryPolicy: "DENY", inventoryItem: { tracked: true, requiresShipping: true }, requiresComponents: false, product: { status: "ACTIVE", isGiftCard: false, requiresSellingPlan: false } }] } });
      if (query.includes("draftOrderCalculate")) return Response.json({ data: { draftOrderCalculate: { userErrors: [], calculatedDraftOrder: {
        subtotalPriceSet: bag("10"), totalShippingPriceSet: bag("0"), totalTaxSet: bag("0"), totalDiscountsSet: bag("0"), totalPriceSet: bag("10"), taxesIncluded: false, shippingLine: { title: "Free standard shipping", shippingRateHandle: null }, warnings: [],
        lineItems: [{ variant: { id: variantId }, quantity: 1, custom: false, title: "Product", requiresShipping: true, taxable: true, originalUnitPriceSet: bag("10"), components: [] }],
      } } } });
      if (query.includes("draftOrderCreate")) {
        creates++; persistedDraft = { id: "gid://shopify/DraftOrder/1", status: "OPEN", email: request.email, reserveInventoryUntil: variables.input.reserveInventoryUntil, customAttributes: variables.input.customAttributes,
          totalPriceSet: bag("10"), totalTaxSet: bag("0"), totalShippingPriceSet: bag("0"), shippingAddress: { ...request.shippingAddress, address2: null, countryCodeV2: "US" },
          lineItems: { nodes: [{ variant: { id: variantId }, quantity: 1, title: "Product", customAttributes: [] }], pageInfo: { hasNextPage: false } }, order: null };
        return Response.json({ data: { draftOrderCreate: { draftOrder: persistedDraft, userErrors: [] } } });
      }
      if (query.includes("draftOrderComplete")) {
        completes++; persistedDraft.status = "COMPLETED"; persistedDraft.order = { id: "gid://shopify/Order/1", displayFinancialStatus: "PAID" };
        return Response.json({ data: { draftOrderComplete: { draftOrder: persistedDraft, userErrors: [] } } });
      }
      return Response.json({ data: { draftOrder: persistedDraft } });
    };
    const started = await startPayment(db, brand.id, request, "checkout_key", "https://example.com/");
    const retried = await startPayment(db, brand.id, request, "checkout_key", "https://example.com/");
    assert.equal(started.attemptId, retried.attemptId); assert.equal(creates, 1); assert.equal(checkoutCreates, 1);
    assert.doesNotMatch(String(db.db.prepare("SELECT data FROM payment_attempts").get()!.data), /buyer@example.com|123 Example Street/);
    assert.equal((await reconcilePayment(db, brand.id, started.attemptId, "pay_test")).state, "completed");
    await reconcilePayment(db, brand.id, started.attemptId, "pay_test");
    assert.equal(completes, 1);
  } finally {
    globalThis.fetch = savedFetch; await db.close();
    if (oldKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY; else process.env.CREDENTIAL_ENCRYPTION_KEY = oldKey;
    if (oldGate === undefined) delete process.env.PAYMENT_ACCEPTANCE_ENABLED; else process.env.PAYMENT_ACCEPTANCE_ENABLED = oldGate;
  }
});

test("Whop succeeded events route only tagged Limitless payments", () => {
  const attemptId = "attempt_12345678-1234-1234-1234-123456789abc";
  assert.deepEqual(whopPaymentReference({ type: "payment.succeeded", data: { id: "pay_123", metadata: { limitless_attempt_id: attemptId } } }), { paymentId: "pay_123", attemptId });
  assert.equal(whopPaymentReference({ type: "payment.failed", data: { id: "pay_123", metadata: { limitless_attempt_id: attemptId } } }), null);
  assert.equal(whopPaymentReference({ type: "payment.succeeded", data: { id: "pay_123", metadata: {} } }), null);
  assert.throws(() => whopPaymentReference({ type: "payment.succeeded", data: { id: "bad", metadata: { limitless_attempt_id: attemptId } } }));
});
