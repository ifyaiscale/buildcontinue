export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECKOUT_RUNTIME = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-checkout-runtime";
const ACTIONS = new Set(["quote", "payment-start", "status"]);

type RouteContext = { params: Promise<{ slug: string; action: string }> };

function response(body: string, status: number) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function forward(request: Request, context: RouteContext) {
  const { slug, action } = await context.params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !ACTIONS.has(action)) {
    return Response.json({ error: "Checkout endpoint not found." }, { status: 404 });
  }

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
      ? { action: "quote", slug, input }
      : {
          action: "payment-start",
          slug,
          input,
          idempotencyKey: request.headers.get("idempotency-key") ?? "",
          returnOrigin: new URL(request.url).origin,
        };
  }

  let upstream: Response;
  try {
    upstream = await fetch(CHECKOUT_RUNTIME, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(action === "quote" ? 30_000 : 45_000),
    });
  } catch {
    return Response.json({ error: "Checkout service is temporarily unavailable." }, { status: 503 });
  }
  return response(await upstream.text(), upstream.status);
}

export async function GET(request: Request, context: RouteContext) { return forward(request, context); }
export async function POST(request: Request, context: RouteContext) { return forward(request, context); }
