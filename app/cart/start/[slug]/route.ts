import { z, ZodError } from "zod";
import { requestSite } from "@/lib/server/hosts";

const CHECKOUT_RUNTIME = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-checkout-runtime";
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const cartSchema = z.object({
  items: z.array(z.object({
    variantId: z.string().trim().min(1).max(200),
    quantity: z.number().int().min(1).max(20),
    personalizationRef: z.string().trim().max(100).optional(),
    personalizationProof: z.string().trim().max(120).optional(),
  }).strict()).min(1).max(30),
}).strict();

function jsonError(error: unknown) {
  if (error instanceof ZodError) return Response.json({ error: "Cart data is invalid." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  return Response.json({ error: "Checkout could not be started. Return to the store and try again." }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const pathname = new URL(request.url).pathname.replace(/\/$/, "");
    const slug = /^\/cart\/start\/([a-z0-9-]+)$/.exec(pathname)?.[1] ?? "";
    if (!slugPattern.test(slug)) return Response.json({ error: "Store not found." }, { status: 404 });

    const site = requestSite(request);
    if (site.kind === "checkout" && site.slug !== slug) return Response.json({ error: "Store not found." }, { status: 404 });

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") return Response.json({ error: "Use a standard checkout form." }, { status: 415 });
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 12_000) return Response.json({ error: "Cart handoff is too large." }, { status: 413 });

    const encoded = await request.text();
    if (Buffer.byteLength(encoded, "utf8") > 12_000) return Response.json({ error: "Cart handoff is too large." }, { status: 413 });
    const form = new URLSearchParams(encoded);
    if (form.getAll("cart").length !== 1) return Response.json({ error: "Cart data is invalid." }, { status: 422 });
    const raw = z.string().min(2).max(8192).parse(form.get("cart"));
    const cart = cartSchema.parse(JSON.parse(raw));

    let upstream: Response;
    try {
      upstream = await fetch(CHECKOUT_RUNTIME, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cart-start",
          slug,
          storefrontOrigin: request.headers.get("origin") ?? "",
          cart,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return Response.json({ error: "Checkout service is temporarily unavailable." }, { status: 503 });
    }
    const result = await upstream.json().catch(() => ({})) as Record<string, unknown>;
    if (!upstream.ok || typeof result.token !== "string") {
      return Response.json({ error: typeof result.error === "string" ? result.error : "Checkout could not be started." }, { status: upstream.status || 503, headers: { "Cache-Control": "no-store" } });
    }

    const target = new URL(`/checkout/${encodeURIComponent(slug)}`, site.origin);
    target.searchParams.set("cart", result.token);
    return new Response(null, {
      status: 303,
      headers: {
        Location: target.toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
