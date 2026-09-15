import { requestSite, requireSitePath } from "@/lib/server/hosts";

const LAUNCH_ADMIN_URL = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-launch-admin";

function sessionToken(request: Request) {
  const cookies = request.headers.get("cookie") || "";
  return cookies
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith("limitless_session="))
    ?.slice("limitless_session=".length) || "";
}

function jsonResponse(body: string, status: number) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function launchAdminAction(
  request: Request,
  brandId: string,
  action: string,
  fields: Record<string, unknown> = {},
) {
  const site = requestSite(request);
  requireSitePath(site, new URL(request.url).pathname);
  if (site.kind !== "admin") return Response.json({ error: "Not found." }, { status: 404 });
  if (!/^brand_[A-Za-z0-9-]+$/.test(brandId)) return Response.json({ error: "Brand not found." }, { status: 404 });

  const token = sessionToken(request);
  if (!token) return Response.json({ error: "Sign in to manage your workspace." }, { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(LAUNCH_ADMIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token, brandId, ...fields }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return Response.json({ error: "Launch administration is temporarily unavailable." }, { status: 503 });
  }

  return jsonResponse(await upstream.text(), upstream.status);
}
