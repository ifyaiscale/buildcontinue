import test from "node:test";
import assert from "node:assert/strict";
import { createWhopCheckout, retrieveVerifiedWhopPayment } from "../lib/server/providers";

const credentials = { companyId: "biz_test", apiKey: "private-test-key" };

test("Whop checkout creation sends an exact one-time USD amount with immutable attempt metadata", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.whop.com/api/v1/checkout_configurations");
      assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "attempt_12345678");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.plan, { initial_price: 64.97, plan_type: "one_time", currency: "usd" });
      assert.deepEqual(body.metadata, { limitless_attempt_id: "attempt_12345678" });
      assert.equal(body.allow_promo_codes, false);
      return Response.json({ id: "ch_test", company_id: "biz_test", mode: "payment", currency: "usd", purchase_url: "/checkout/plan_test?session=ch_test", metadata: body.metadata, plan: { id: "plan_test", initial_price: 64.97, plan_type: "one_time" } });
    };
    const result = await createWhopCheckout(credentials, { attemptId: "attempt_12345678", totalCents: 6497, returnUrl: "https://checkout.example/complete" });
    assert.equal(result.purchaseUrl, "https://whop.com/checkout/plan_test?session=ch_test");
  } finally { globalThis.fetch = original; }
});

test("Whop payment retrieval independently enforces status, company, USD total, checkout, and attempt", async () => {
  const original = globalThis.fetch;
  const valid = { id: "pay_test", status: "paid", substatus: "succeeded", company: { id: "biz_test" }, currency: "usd", total: 64.97, metadata: { limitless_attempt_id: "attempt_12345678" }, checkout_configuration_id: "ch_test" };
  const input = { paymentId: "pay_test", attemptId: "attempt_12345678", checkoutConfigurationId: "ch_test", totalCents: 6497 };
  try {
    globalThis.fetch = async () => Response.json(valid);
    assert.equal((await retrieveVerifiedWhopPayment(credentials, input)).paid, true);
    for (const changed of [
      { total: 64.96 }, { currency: "cad" }, { company: { id: "biz_other" } },
      { metadata: { limitless_attempt_id: "attempt_other" } }, { checkout_configuration_id: "ch_other" },
      { status: "open", substatus: "pending" },
    ]) {
      globalThis.fetch = async () => Response.json({ ...valid, ...changed });
      await assert.rejects(retrieveVerifiedWhopPayment(credentials, input), /does not match|not successfully paid/);
    }
  } finally { globalThis.fetch = original; }
});
