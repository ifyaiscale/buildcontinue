import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../lib/server/store";
import { enqueuePayment, runPaymentJob } from "../lib/server/payment-jobs";

test("payment inbox survives retries, deduplicates delivery and leases concurrent workers", async () => {
  const db = new Store(":memory:");
  try {
    const ref = { attemptId: "attempt_test", paymentId: "pay_test" };
    await Promise.all(Array.from({ length: 5 }, () => enqueuePayment(db, "brand_1", ref, 0)));
    await assert.rejects(enqueuePayment(db, "brand_1", { ...ref, attemptId: "other" }, 0), /conflicts/);
    let calls = 0;
    const fail = async () => { calls++; throw new Error("private provider failure"); };
    await Promise.all([runPaymentJob(db, fail, 0), runPaymentJob(db, fail, 0)]);
    assert.equal(calls, 1);
    assert.equal(await runPaymentJob(db, fail, 59_999), false);
    const done = async () => { calls++; return { state: "completed" as const, orderId: "gid://shopify/Order/1" }; };
    await runPaymentJob(db, done, 60_000);
    await enqueuePayment(db, "brand_1", ref, 61_000);
    assert.equal(await runPaymentJob(db, done, 120_000), false);
    assert.equal(calls, 2);
    const saved = String(db.db.prepare("SELECT data FROM webhook_events").get()!.data);
    assert.doesNotMatch(saved, /private provider failure/);
    assert.equal(JSON.parse(saved).status, "completed");
  } finally { await db.close(); }
});
