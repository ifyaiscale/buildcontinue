export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECKOUT_RUNTIME = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-checkout-runtime";
const ACCEPTANCE_RUNTIME = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-acceptance-checkout";
const ACTIONS = new Set(["quote", "payment-start", "status"]);

type RouteContext = { params: Promise<{ slug: string; action: string }> };

function response(body: string, status: number, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function acceptanceToken(request: Request, slug: string) {
  const name = `limitless_acceptance_${slug}=`;
  const value = (request.headers.get("cookie") || "")
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(name))
    ?.slice(name.length) || "";
  return /^v3\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) && value.length <= 5000 ? value : "";
}

function sanitizeQuote(body: string) {
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    if (value && typeof value === "object") delete value.draftInput;
    return JSON.stringify(value);
  } catch {
    return body;
  }
}

function acceptanceAttemptCookie(body: string, slug: string) {
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    const attemptId = typeof value.attemptId === "string" ? value.attemptId : "";
    if (value.acceptanceMode !== true || !/^attempt_[0-9a-f-]{36}$/.test(attemptId)) return "";
    return `limitless_acceptance_attempt_${slug}=${attemptId}; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax`;
  } catch {
    return "";
  }
}

async function forward(request: Request, context: RouteContext) {
  const { slug, action } = await context.params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !ACTIONS.has(action)) {
    return Response.json({ error: "Checkout endpoint not found." }, { status: 404 });
  }

  const privateAcceptance = action !== "status" ? acceptanceToken(request, slug) : "";
  let payload: Record<string, unknown>;
  if (action === "status") {
    if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
    payload = { action: "status", slug, receipt: new URL(request.url).searchParams.get("receipt") ?? "" };
  } else {
    if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return Response.json({ error: "Use application/json." }, { status: 415 });
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > 24_000) return Response.json({ error: "Checkout request is too large." }, { status: 413 });
    let input: unknown;
    try { input = JSON.parse(raw); }
    catch { return Response.json({ error: "Invalid checkout request." }, { status: 400 }); }

    payload = action === "quote"
      ? { action: "quote", slug, input, ...(privateAcceptance ? { acceptanceToken: privateAcceptance } : {}) }
      : {
          action: "payment-start",
          slug,
          input,
          idempotencyKey: request.headers.get("idempotency-key") ?? "",
          returnOrigin: new URL(request.url).origin,
          ...(privateAcceptance ? { acceptanceToken: privateAcceptance } : {}),
        };
  }

  const target = privateAcceptance ? ACCEPTANCE_RUNTIME : CHECKOUT_RUNTIME;
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(action === "quote" ? 30_000 : 45_000),
    });
  } catch {
    return Response.json({ error: "Checkout service is temporarily unavailable." }, { status: 503 });
  }

  const body = await upstream.text();
  const headers: Record<string, string> = {};
  if (action === "payment-start" && privateAcceptance && upstream.ok) {
    const cookie = acceptanceAttemptCookie(body, slug);
    if (cookie) headers["Set-Cookie"] = cookie;
  }
  return response(action === "quote" && upstream.ok ? sanitizeQuote(body) : body, upstream.status, headers);
}

export async function GET(request: Request, context: RouteContext) { return forward(request, context); }
export async function POST(request: Request, context: RouteContext) { return forward(request, context); }
