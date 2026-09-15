import { json, route } from "@/lib/server/http";
import { requestSite, requireSitePath } from "@/lib/server/hosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_URL = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-admin-state";

function sessionToken(request: Request) {
  const cookies = request.headers.get("cookie") || "";
  return cookies
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith("limitless_session="))
    ?.slice("limitless_session=".length) || "";
}

export const GET = route(async (request: Request) => {
  const site = requestSite(request);
  requireSitePath(site, "/api/state");
  if (site.kind !== "admin") return json({ error: "Not found." }, 404);

  const token = sessionToken(request);
  if (!token) return json({ error: "Sign in to manage your workspace." }, 401);

  let response: Response;
  try {
    response = await fetch(STATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return json({ error: "Workspace data is temporarily unavailable." }, 503);
  }

  let snapshot: { brands?: unknown[]; orders?: unknown[]; activity?: unknown[]; error?: string } = {};
  try { snapshot = await response.json(); }
  catch { return json({ error: "Workspace data is temporarily unavailable." }, 503); }

  if (response.status === 401) return json({ error: "Sign in to manage your workspace." }, 401);
  if (!response.ok || !Array.isArray(snapshot.brands) || !Array.isArray(snapshot.orders) || !Array.isArray(snapshot.activity)) {
    return json({ error: snapshot.error || "Workspace data is temporarily unavailable." }, 503);
  }

  return json({
    brands: snapshot.brands,
    orders: snapshot.orders,
    activity: snapshot.activity,
    environment: {
      demo: false,
      liveEnabled: process.env.PUBLIC_PAYMENT_ENABLED === "true",
      credentialsConfigured: false,
      authenticated: true,
    },
  });
});
