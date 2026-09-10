import { HttpError } from "./errors";

export type Site = { kind: "admin"; origin: string } | { kind: "checkout"; origin: string; slug: string };
type RequestSite = Pick<Request, "headers" | "url">;

function parseOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new HttpError(503, "Configure APP_URL and CHECKOUT_ORIGINS with valid origins."); }
  if (url.origin !== value || !["http:", "https:"].includes(url.protocol) || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) throw new HttpError(503, "Configure APP_URL and CHECKOUT_ORIGINS with exact origins using HTTPS in production.");
  return url;
}

function checkoutSites(adminOrigin?: URL): Map<string, Site> {
  const sites = new Map<string, Site>();
  const raw = process.env.CHECKOUT_ORIGINS;
  if (!raw) return sites;
  let entries: unknown;
  try { entries = JSON.parse(raw); }
  catch { throw new HttpError(503, "CHECKOUT_ORIGINS must be a JSON object of origins to brand slugs."); }
  if (!entries || typeof entries !== "object" || Array.isArray(entries) || Object.keys(entries).length > 100) throw new HttpError(503, "CHECKOUT_ORIGINS must contain at most 100 registered origins.");
  for (const [origin, slug] of Object.entries(entries)) {
    const url = parseOrigin(origin);
    if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 200) throw new HttpError(503, "Each checkout origin must map to a valid brand slug.");
    if (sites.has(url.host) || url.host === adminOrigin?.host) throw new HttpError(503, "Admin and checkout hosts must be distinct, with one origin per host.");
    sites.set(url.host, { kind: "checkout", origin, slug });
  }
  return sites;
}

export function requestSite(request: RequestSite): Site {
  const url = new URL(request.url);
  const host = (request.headers.get("host") || url.host).toLowerCase();
  const admin = process.env.APP_URL ? parseOrigin(process.env.APP_URL) : undefined;
  if (!admin && process.env.NODE_ENV === "production") throw new HttpError(503, "Configure APP_URL with the application origin before serving requests.");
  const sites = checkoutSites(admin);
  // The deployment proxy must preserve Host. Arbitrary forwarded-host headers are not trusted.
  const checkout = sites.get(host);
  if (checkout) return checkout;
  if (admin?.host === host) return { kind: "admin", origin: admin.origin };
  if (process.env.NODE_ENV === "production") throw new HttpError(404, "Site not configured.");
  const local = parseOrigin(process.env.APP_URL || `${url.protocol}//${host}`);
  if (sites.has(local.host)) throw new HttpError(503, "Admin and checkout hosts must be distinct.");
  return { kind: "admin", origin: local.origin };
}

export function requireSitePath(site: Site, pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (site.kind === "checkout" && !["/", `/checkout/${site.slug}`, `/api/checkout/${site.slug}`].includes(path)) throw new HttpError(404, "Page not available on this checkout domain.");
}
