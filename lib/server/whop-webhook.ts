import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./errors";

const eventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  api_version: z.literal("v1"),
  timestamp: z.string().datetime({ offset: true }),
  account_id: z.string().optional(),
  company_id: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
}).passthrough();

export type WhopWebhookEvent = z.infer<typeof eventSchema>;

function header(headers: Headers, name: string) {
  const value = headers.get(name);
  if (!value) throw new HttpError(400, "Missing Whop webhook signature headers.");
  return value;
}

export function verifyWhopWebhook(rawBody: string, headers: Headers, secret: string, nowMs = Date.now()): WhopWebhookEvent {
  if (!/^ws_[A-Za-z0-9_-]{16,}$/.test(secret)) throw new HttpError(503, "Whop webhook signing is not configured for this brand.");
  const webhookId = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signatureHeader = header(headers, "webhook-signature");
  if (!/^\d{10,13}$/.test(timestamp)) throw new HttpError(400, "Invalid Whop webhook timestamp.");
  const timestampMs = Number(timestamp) * (timestamp.length === 10 ? 1000 : 1);
  if (!Number.isSafeInteger(timestampMs) || Math.abs(nowMs - timestampMs) > 5 * 60 * 1000) throw new HttpError(400, "Expired Whop webhook timestamp.");
  const expected = createHmac("sha256", secret).update(`${webhookId}.${timestamp}.${rawBody}`).digest();
  const signatures = signatureHeader.split(/\s+/).map(value => value.replace(/^v1,/, "")).filter(Boolean);
  const valid = signatures.some(value => {
    try { const actual = Buffer.from(value, "base64"); return actual.length === expected.length && timingSafeEqual(actual, expected); }
    catch { return false; }
  });
  if (!valid) throw new HttpError(401, "Invalid Whop webhook signature.");
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { throw new HttpError(400, "Invalid Whop webhook payload."); }
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success || parsed.data.id !== webhookId) throw new HttpError(400, "Invalid Whop webhook event.");
  return parsed.data;
}
