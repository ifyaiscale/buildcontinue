import { createHmac, timingSafeEqual } from "node:crypto";

export function workerSignature(secret: string, timestamp: string) {
  if (secret.length < 32) throw new Error("Worker authentication is not configured.");
  return createHmac("sha256", secret).update(`limitless-payment-worker:${timestamp}`).digest("hex");
}

export function validWorkerRequest(headers: Headers, secret: string, now = Date.now()) {
  const timestamp = headers.get("x-worker-time") ?? "";
  const signature = headers.get("x-worker-signature") ?? "";
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 60_000 || !/^[a-f0-9]{64}$/.test(signature) || secret.length < 32) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(workerSignature(secret, timestamp), "hex"));
}
