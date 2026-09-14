import { z, ZodError } from "zod";
import { createCartSession } from "@/lib/server/cart-session";
import { requestSite } from "@/lib/server/hosts";
import { HttpError, rateLimit } from "@/lib/server/security";
import { store } from "@/lib/server/store";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function errorResponse(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  if (error instanceof ZodError) return Response.json({ error: "Cart data is invalid." }, { status: 422, headers: { "Cache-Control": "no-store" } });
  return Response.json({ error: "Checkout could not be started. Return to the store and try again." }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

function storefrontDomains(values: string[]) {
  const domains = new Set<string>();
  for (const raw of values) {
    const domain = raw.trim().toLowerCase();
    if (!domain) continue;
    domains.add(domain);
    if (domain.startsWith("www.")) domains.add(domain.slice(4));
    else domains.add(`www.${domain}`);
  }
  return domains;
}

function requireStorefrontOrigin(request: Request, domains: Set<string>) {
  const origin = request.headers.get("origin");
  if (!origin) throw new HttpError(403, "Open checkout from the store cart.");
  let url: URL;
  try { url = new URL(origin); }
  catch { throw new HttpError(403, "Open checkout from the store cart."); }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new HttpError(403, "Open checkout from the secure store.");
  if (!domains.has(url.hostname.toLowerCase())) throw new HttpError(403, "This storefront is not authorized for this checkout.");
}

export async function POST(request: Request) {
  try {
    rateLimit("storefront-cart-start", 120, 60_000);
    const pathname = new URL(request.url).pathname.replace(/\/$/, "");
    const slug = /^\/cart\/start\/([a-z0-9-]+)$/.exec(pathname)?.[1] ?? "";
    if (!slugPattern.test(slug)) throw new HttpError(404, "Store not found.");

    const site = requestSite(request);
    if (site.kind === "checkout" && site.slug !== slug) throw new HttpError(404, "Store not found.");

    const db = await store();
    const brand = await db.brand(slug, true);
    const domains = storefrontDomains([brand.domain, ...(brand.accountDetails?.storefrontAliases ?? [])]);
    requireStorefrontOrigin(request, domains);

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") throw new HttpError(415, "Use a standard checkout form.");
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 12_000) throw new HttpError(413, "Cart handoff is too large.");
    const encoded = await request.text();
    if (Buffer.byteLength(encoded, "utf8") > 12_000) throw new HttpError(413, "Cart handoff is too large.");
    const form = new URLSearchParams(encoded);
    if (form.getAll("cart").length !== 1) throw new HttpError(422, "Cart data is invalid.");
    const raw = z.string().min(2).max(8192).parse(form.get("cart"));
    let cart: unknown;
    try { cart = JSON.parse(raw); }
    catch { throw new HttpError(422, "Cart data is invalid."); }

    const session = createCartSession(brand, cart);
    const target = new URL(`/checkout/${encodeURIComponent(slug)}`, site.origin);
    target.searchParams.set("cart", session.token);
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
    return errorResponse(error);
  }
}
