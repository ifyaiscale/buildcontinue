import { body, json, route } from "@/lib/server/http";
import { requestSite, requireSitePath } from "@/lib/server/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER_URL = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-provider-admin";
const WHOP_PROVIDER_URL = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-whop-admin";

function sessionToken(request: Request) {
  const cookies = request.headers.get("cookie") || "";
  return cookies
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith("limitless_session="))
    ?.slice("limitless_session=".length) || "";
}

export const POST = route(async (request: Request) => {
  const site = requestSite(request);
  const pathname = new URL(request.url).pathname;
  requireSitePath(site, pathname);
  if (site.kind !== "admin") return json({ error: "Not found." }, 404);

  const match = pathname.match(/^\/api\/brands\/([A-Za-z0-9_-]+)\/connections$/);
  if (!match) return json({ error: "Brand not found." }, 404);
  const token = sessionToken(request);
  if (!token) return json({ error: "Sign in to manage your workspace." }, 401);
  const connection = await body(request) as Record<string, unknown>;
  const useManualWhop = connection?.provider === "whop" && typeof connection.webhookSecret === "string" && connection.webhookSecret.trim().length > 0;
  const target = useManualWhop ? WHOP_PROVIDER_URL : PROVIDER_URL;

  let response: Response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "connect", token, brandId: match[1], connection }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return json({ error: "Provider verification service is temporarily unavailable." }, 503);
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return json({ error: "Provider verification service returned an invalid response." }, 503);
  }
  return json(result, response.status);
});
