export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPTANCE_RUNTIME = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-acceptance-checkout";
const CHECKOUT_HOSTS: Record<string, string> = {
  chefings: "checkout.chefings.com",
  cozyinfants: "checkout.cozyinfants.com",
  facejamas: "checkout.facejamas.com",
};

type RouteContext = { params: Promise<{ slug: string }> };

function requestHost(request: Request) {
  return (request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || new URL(request.url).host).toLowerCase();
}

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const expectedHost = CHECKOUT_HOSTS[slug];
  if (!expectedHost || requestHost(request) !== expectedHost) {
    return Response.json({ error: "Controlled checkout is not available on this host." }, { status: 404 });
  }

  const token = new URL(request.url).searchParams.get("token")?.trim() || "";
  if (!/^v3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 5000) {
    return Response.json({ error: "Controlled acceptance link is invalid." }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(ACCEPTANCE_RUNTIME, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "arm", slug, acceptanceToken: token }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: "Controlled acceptance is temporarily unavailable." }, { status: 503 });
  }

  const result = await upstream.json().catch(() => ({})) as Record<string, unknown>;
  if (!upstream.ok) {
    return Response.json({ error: typeof result.error === "string" ? result.error : "Controlled acceptance could not be armed." }, { status: upstream.status });
  }

  const storefrontUrl = typeof result.storefrontUrl === "string" ? result.storefrontUrl : "";
  const expiresAt = Number(result.expiresAt);
  let target: URL;
  try { target = new URL(storefrontUrl); }
  catch { return Response.json({ error: "Controlled acceptance returned an invalid storefront." }, { status: 502 }); }
  if (target.protocol !== "https:" || target.pathname !== "/" || target.search || target.hash || target.hostname !== slug.replace("cozyinfants", "cozyinfants").replace("facejamas", "facejamas").replace("chefings", "chefings") + ".com") {
    return Response.json({ error: "Controlled acceptance returned an untrusted storefront." }, { status: 502 });
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    return Response.json({ error: "Controlled acceptance session already expired." }, { status: 410 });
  }

  const maxAge = Math.max(1, Math.min(20 * 60, Math.floor((expiresAt - Date.now()) / 1000)));
  const cookie = `limitless_acceptance_${slug}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return new Response(null, {
    status: 303,
    headers: {
      Location: target.toString(),
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
