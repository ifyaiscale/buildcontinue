import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabase } from "../lib/server/database";
import { PaymentAttempts } from "../lib/server/payment-attempts";

test("concurrent payment attempts share one identity and cannot change cart, brand, draft or order", async () => {
  const db = new SqliteDatabase(":memory:"); const ledger = new PaymentAttempts(db);
  const input = { brandId: "brand_a", key: "checkout_12345", shopifyDomain: "test.myshopify.com", whopCompanyId: "biz_test", totalCents: 6497, cartFingerprint: "cart-and-address" };
  try {
    const attempts = await Promise.all(Array.from({ length: 8 }, () => ledger.prepare(input, 1000)));
    const id = attempts[0].id;
    assert.ok(attempts.every(a => a.id === id));
    await assert.rejects(ledger.prepare({ ...input, totalCents: 1_000 }, 1000), /different cart/);
    await assert.rejects(ledger.get("brand_b", id), /not found/);
    await ledger.beginDraft(input.brandId, id, 1000);
    await assert.rejects(ledger.beginDraft(input.brandId, id, 1000), /already started/);
    await ledger.bindDraft(input.brandId, id, "gid://shopify/DraftOrder/1");
    await assert.rejects(ledger.bindDraft(input.brandId, id, "gid://shopify/DraftOrder/2"), /different draft/);
    await ledger.bindCheckout(input.brandId, id, "ch_test", 1000);
    await ledger.acceptVerifiedPayment(input.brandId, id, "pay_test", 1000);
    await ledger.complete(input.brandId, id, "gid://shopify/Order/1");
    assert.equal((await ledger.acceptVerifiedPayment(input.brandId, id, "pay_test", 1000)).state, "completed");
    await assert.rejects(ledger.complete(input.brandId, id, "gid://shopify/Order/2"), /another order/);
    assert.equal((await ledger.acceptVerifiedPayment(input.brandId, id, "pay_second", 1000)).state, "review");
    assert.equal((await ledger.get(input.brandId, id)).orderId, "gid://shopify/Order/1");
  } finally { await db.close(); }
});
