import test from "node:test";
import assert from "node:assert/strict";
import { workerSignature, validWorkerRequest } from "../lib/server/worker-auth";

test("payment worker rejects missing, forged and expired internal triggers", () => {
  const secret = "a".repeat(64), time = 1_800_000_000_000;
  const headers = new Headers({ "x-worker-time": String(time), "x-worker-signature": workerSignature(secret, String(time)) });
  assert.equal(validWorkerRequest(headers, secret, time), true);
  assert.equal(validWorkerRequest(headers, "b".repeat(64), time), false);
  assert.equal(validWorkerRequest(headers, secret, time + 60_001), false);
  assert.equal(validWorkerRequest(new Headers(), secret, time), false);
});
