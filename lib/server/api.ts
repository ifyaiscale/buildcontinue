import type { AppState, Brand } from "../types";
import { authenticated, authConfigured, demoMode, encryptionConfigured, HttpError, rateLimit, requireAdmin, requireCredentials, sessionCookie, verifyPassword } from "./security";
import { body, json, route } from "./http";
import { store } from "./store";
import { connectionInput, loginInput, publishInput } from "./validation";
import { syncShopify, verifyShopify, verifyWhop, type ShopifyCredentials } from "./providers";
import { accountDetails } from "../accounts";

function publicBrand(brand: Brand): Brand {
  const { accountDetails: _accountDetails, ...publicFields } = brand;
  return { ...publicFields, domain: "", shopify: { status: brand.shopify.status }, whop: { status: brand.whop.status }, products: brand.products.map(({ variantId: _variantId, ...product }) => product) };
}

export async function handleApi(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const method = request.method;
  if (path === "/api/auth/status" && method === "GET") return json({ authenticated: authenticated(request), configured: authConfigured(), demo: demoMode() });
  if (path === "/api/auth/login" && method === "POST") {
    // A global bucket cannot be bypassed by spoofing proxy/IP headers.
    rateLimit("login", 10, 15 * 60 * 1000);
    if (!authConfigured()) throw new HttpError(503, "Configure admin authentication before signing in.");
    const { password } = loginInput.parse(await body(request));
    if (!verifyPassword(password)) throw new HttpError(401, "Incorrect password.");
    return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie() });
  }
  if (path === "/api/auth/logout" && method === "POST") return json({ authenticated: false }, 200, { "Set-Cookie": sessionCookie(true) });

  if (path === "/api/state" && method === "GET") {
    requireAdmin(request);
    const db = store();
    const state: AppState = { brands: db.brands(), orders: db.orders(), activity: db.activity(), environment: { demo: demoMode(), liveEnabled: false, credentialsConfigured: authConfigured() && encryptionConfigured(), authenticated: authenticated(request) } };
    return json(state);
  }
  if (path === "/api/brands" && method === "POST") {
    requireAdmin(request); rateLimit("brand-create", 60, 60000);
    return json(store().createBrand(await body(request)), 201);
  }
  const checkout = path.match(/^\/api\/checkout\/([a-z0-9-]+)$/);
  if (checkout && (method === "GET" || method === "POST")) {
    if (!authConfigured() && !demoMode()) throw new HttpError(503, "This deployment is not configured for checkout.");
    const slug = checkout[1]; const db = store(); const brand = db.brand(slug, true);
    const allowDraft = authenticated(request) || demoMode();
    if (brand.status !== "live" && !allowDraft) throw new HttpError(404, "Checkout is not published.");
    if (method === "GET") return json(publicBrand(brand));
    rateLimit("checkout", 120, 60000);
    const key = request.headers.get("idempotency-key") ?? undefined;
    if (key && !/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new HttpError(422, "Use an 8–100 character alphanumeric idempotency key.");
    return json(db.checkout(slug, await body(request), allowDraft, key), 201);
  }
  const brandRoute = path.match(/^\/api\/brands\/([a-zA-Z0-9_-]+)(?:\/(connections|products\/sync|products|publish))?$/);
  if (brandRoute) {
    const [, brandId, action] = brandRoute;
    requireAdmin(request);
    if (!action && method === "PATCH") return json(store().updateBrand(brandId, await body(request)));
    if (action === "products" && method === "POST") {
      rateLimit("test-product-create", 60, 60000);
      return json(store().addTestProduct(brandId, await body(request)), 201);
    }
    if (action === "publish" && method === "POST") return json(store().publish(brandId, publishInput.parse(await body(request)).mode));
    if (action === "connections" && method === "POST") {
      requireCredentials(request); rateLimit("connections", 20, 60000);
      const input = connectionInput.parse(await body(request)); const db = store(); db.brand(brandId);
      const account = input.provider === "shopify" ? await verifyShopify(input) : await verifyWhop(input.companyId, input.apiKey);
      return json(db.transaction(() => {
        const brand = db.brand(brandId);
        db.setCredential(brandId, input.provider, input);
        brand.accountDetails = {
          ...accountDetails(brand),
          ...(input.provider === "shopify" ? { shopifyDomain: account } : { whopCompanyId: account }),
        };
        brand[input.provider] = { status: "verified", account, checkedAt: new Date().toISOString() };
        if (input.provider === "shopify") {
          // Reconnecting a different catalog invalidates published product references.
          brand.products = []; brand.status = "draft";
        }
        db.saveBrand(brand); db.addActivity(`${brand.name}: ${input.provider} API access verified (not live payments)`, "connection", brand.id);
        return brand;
      }));
    }
    if (action === "products/sync" && method === "POST") {
      requireCredentials(request); rateLimit("product-sync", 5, 60000);
      const db = store(); db.brand(brandId);
      const credentials = db.credential<ShopifyCredentials>(brandId, "shopify");
      const products = await syncShopify(credentials);
      return json(db.transaction(() => {
        const current = db.credential<ShopifyCredentials>(brandId, "shopify");
        if (current.domain !== credentials.domain || current.accessToken !== credentials.accessToken) throw new HttpError(409, "Connection changed during import. Sync again.");
        const brand = db.brand(brandId); brand.products = products;
        if (!products.some(p => p.available)) brand.status = "draft";
        brand.shopify = { ...brand.shopify, status: "verified", checkedAt: new Date().toISOString() };
        db.saveBrand(brand); db.addActivity(`${products.length} Shopify variants imported for ${brand.name}`, "connection", brandId);
        return brand;
      }));
    }
  }
  throw new HttpError(404, "API endpoint not found.");
}

const handler = route(handleApi);
export { handler as state, handler as addBrand, handler as editBrand, handler as connect, handler as syncProducts, handler as publish, handler as checkoutGet, handler as checkoutPost, handler as authStatus, handler as login, handler as logout };
