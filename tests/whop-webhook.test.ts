import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWhopWebhook } from "../lib/server/whop-webhook";

const secret = "ws_0123456789abcdef0123456789abcdef";
const now = 1_786_381_404_000;

function signed(body: string, timestamp = String(now / 1000), id = "msg_test") {
  const signature = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Headers({ "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}`, "content-type": "application/json" });
}

test("Whop webhook verification uses the exact raw body and accepts a current matching event", () => {
  const body = JSON.stringify({ id: "msg_test", type: "payment.succeeded", api_version: "v1", timestamp: new Date(now).toISOString(), account_id: "biz_test", data: { id: "pay_test" } });
  const event = verifyWhopWebhook(body, signed(body), secret, now);
  assert.equal(event.type, "payment.succeeded");
  assert.equal(event.data.id, "pay_test");
  assert.throws(() => verifyWhopWebhook(`${body}\n`, signed(body), secret, now), /signature/);
});

test("Whop webhook verification rejects replayed, mismatched, malformed, and unsigned events", () => {
  const body = JSON.stringify({ id: "msg_test", type: "payment.succeeded", api_version: "v1", timestamp: new Date(now).toISOString(), company_id: "biz_test", data: { id: "pay_test" } });
  assert.throws(() => verifyWhopWebhook(body, signed(body, String(now / 1000 - 301)), secret, now), /Expired/);
  assert.throws(() => verifyWhopWebhook(body, signed(body, String(now / 1000), "msg_other"), secret, now), /event/);
  assert.throws(() => verifyWhopWebhook("not-json", signed("not-json"), secret, now), /payload/);
  assert.throws(() => verifyWhopWebhook(body, new Headers(), secret, now), /Missing/);
  for (const prefix of ["v2,", ""]) {
    const headers = signed(body);
    headers.set("webhook-signature", headers.get("webhook-signature")!.replace("v1,", prefix));
    assert.throws(() => verifyWhopWebhook(body, headers, secret, now), /signature/);
  }
});
