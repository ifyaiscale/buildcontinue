import { z } from "zod";
import { json, route } from "../../../../../lib/server/http";
import { HttpError, rateLimit, requireCredentials } from "../../../../../lib/server/security";
import { store } from "../../../../../lib/server/store";
import type { WhopCredentials } from "../../../../../lib/server/providers";

const webhookListSchema = z.object({
  data: z.array(z.object({
    id: z.string().regex(/^hook_[A-Za-z0-9_-]+$/),
    url: z.string().url(),
    enabled: z.boolean(),
    events: z.array(z.string()),
    resource_id: z.string().optional(),
  }).passthrough()),
}).passthrough();

const createdWebhookSchema = z.object({
  id: z.string().regex(/^hook_[A-Za-z0-9_-]+$/),
  url: z.string().url(),
  enabled: z.boolean(),
  events: z.array(z.string()),
  api_version: z.literal("v1"),
  resource_id: z.string(),
  webhook_secret: z.string().regex(/^(?:ws|whsec)_[A-Za-z0-9_-]{16,}$/),
}).passthrough();

async function whopRequest(path: string, apiKey: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`https://api.whop.com/api/v1${path}`, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new HttpError(502, "Whop could not be reached while provisioning the webhook.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new HttpError(422, "This Whop API key needs the developer:manage_webhook permission. Update this brand's Whop API key with that permission, then retry.");
  }
  if (response.status === 429) throw new HttpError(429, "Whop rate limit reached. Retry shortly.");
  if (!response.ok) throw new HttpError(502, `Whop could not provision the webhook (HTTP ${response.status}).`);
  if (response.status === 204) return null;
  try { return await response.json(); }
  catch { throw new HttpError(502, "Whop returned an invalid webhook response."); }
}

async function provision(request: Request) {
  if (request.method !== "POST") throw new HttpError(405, "Method not allowed.");
  requireCredentials(request);
  rateLimit("whop-webhook-provision", 12, 60_000);

  const match = new URL(request.url).pathname.match(/^\/api\/brands\/([A-Za-z0-9_-]+)\/whop-webhook$/);
  if (!match) throw new HttpError(404, "Brand not found.");
  const brandId = match[1];
  const db = await store();
  const brand = await db.brand(brandId);
  const credentials = await db.credential<WhopCredentials>(brand.id, "whop");
  if (brand.whop.status !== "verified" || brand.whop.account !== credentials.companyId) throw new HttpError(409, "Verify this brand's Whop connection before provisioning its webhook.");

  const appUrl = process.env.APP_URL?.trim() || "";
  let appOrigin: URL;
  try { appOrigin = new URL(appUrl); }
  catch { throw new HttpError(503, "APP_URL is not configured for webhook provisioning."); }
  if (appOrigin.protocol !== "https:" || appOrigin.origin !== appUrl) throw new HttpError(503, "APP_URL must be an exact HTTPS origin before provisioning webhooks.");

  // The webhook receiver resolves this path segment as a brand ID, not a slug.
  const endpoint = `${appOrigin.origin}/api/webhooks/whop/${brand.id}`;

  const listed = webhookListSchema.safeParse(await whopRequest(`/webhooks?company_id=${encodeURIComponent(credentials.companyId)}&first=100`, credentials.apiKey));
  if (!listed.success) throw new HttpError(502, "Whop returned an invalid webhook list.");
  const matching = listed.data.data.filter(webhook => webhook.url === endpoint);
  for (const webhook of matching) {
    await whopRequest(`/webhooks/${encodeURIComponent(webhook.id)}`, credentials.apiKey, { method: "DELETE" });
  }

  const created = createdWebhookSchema.safeParse(await whopRequest("/webhooks", credentials.apiKey, {
    method: "POST",
    body: JSON.stringify({
      url: endpoint,
      api_version: "v1",
      api_version_date: "2026-08-21-1",
      child_resource_events: false,
      enabled: true,
      events: ["payment.succeeded"],
      resource_id: credentials.companyId,
    }),
  }));
  if (!created.success || created.data.url !== endpoint || created.data.resource_id !== credentials.companyId || !created.data.events.includes("payment.succeeded")) {
    throw new HttpError(502, "Whop created a webhook that did not match the requested brand callback.");
  }

  await db.setCredential(brand.id, "whop", { ...credentials, webhookSecret: created.data.webhook_secret });
  await db.addActivity(`${brand.name}: signed Whop payment webhook provisioned`, "connection", brand.id);
  return json({ configured: true, endpoint, webhookId: created.data.id });
}

export const POST = route(provision);
