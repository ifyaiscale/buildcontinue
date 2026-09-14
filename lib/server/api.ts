import type { AppState, Brand } from "../types";
import { authenticated, authConfigured, csrfChallenge, demoMode, encryptionConfigured, HttpError, rateLimit, requireAdmin, requireCredentials, sessionCookie, verifyPassword } from "./security";
import { body, json, route } from "./http";
import { store } from "./store";
import { connectionInput, loginInput, publishInput } from "./validation";
import { syncShopify, verifyShopify, verifyWhop, sameShopifyCredentials, type ShopifyCredentials } from "./providers";
import { accountDetails } from "../accounts";
import { requestSite, requireSitePath } from "./hosts";
import { calculatePaymentQuote } from "./payment-quote";
import { calculateLaunchQuote } from "./launch-quote";
import { verifyWhopWebhook } from "./whop-webhook";
import { startPayment, reconcilePayment, whopPaymentReference } from "./payment-service";
import { enqueuePayment } from "./payment-jobs";
import { customerPaymentStatus, publicPaymentEnabled, quoteCustomerCheckout, startCustomerCheckoutPayment } from "./customer-checkout";
import { activateLiveCheckout, launchReadiness, recordLaunchAcceptance } from "./launch-activation";
import { z } from "zod";

function publicBrand(brand: Brand): Brand {
  const { accountDetails: _accountDetails, ...publicFields } = brand;
  return { ...publicFields, domain: "", shopify: { status: brand.shopify.status }, whop: { status: brand.whop.status }, products: brand.products.map(({ variantId: _variantId, ...product }) => product) };
}

export async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method;
  const site = requestSite(request);
  requireSitePath(site, path);
  const whopWebhook = path.match(/^\/api\/webhooks\/whop\/([a-zA-Z0-9_-]+)$/);
  if (whopWebhook && method === "POST") {
    rateLimit("whop-webhook", 600, 60000);
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 65536) throw new HttpError(413, "Whop webhook payload is too large.");
    const db = await store();
    const brand = await db.brand(whopWebhook[1]);
    const credentials = await db.credential<{ companyId: string; webhookSecret?: string }>(brand.id, "whop");
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 65536) throw new HttpError(413, "Whop webhook payload is too large.");
    const event = verifyWhopWebhook(rawBody, request.headers, credentials.webhookSecret ?? "");
    const accountId = event.account_id ?? event.company_id;
    if (!accountId || accountId !== credentials.companyId || accountId !== brand.whop.account) throw new HttpError(422, "Whop webhook account does not match this brand.");
    const resourceId = typeof event.data.id === "string" ? event.data.id : undefined;
    const recorded = await db.recordWebhookEvent(brand.id, { id: event.id, type: event.type, accountId, ...(resourceId ? { resourceId } : {}), receivedAt: new Date().toISOString() });
    const payment = whopPaymentReference(event);
    if (payment) await enqueuePayment(db, brand.id, payment);
    return json({ received: true, duplicate: recorded.duplicate, processed: Boolean(payment) });
  }
  if (path === "/api/auth/csrf" && method === "GET") {
    const challenge = csrfChallenge(request);
    return json({ token: challenge.token }, 200, challenge.cookie ? { "Set-Cookie": challenge.cookie } : {});
  }
  if (path === "/api/auth/status" && method === "GET") return json({ authenticated: authenticated(request), configured: authConfigured(), demo: demoMode() });
  if (path === "/api/auth/login" && method === "POST") {
    rateLimit("login", 10, 15 * 60 * 1000);
    if (!authConfigured()) throw new HttpError(503, "Configure admin authentication before signing in.");
    const { password } = loginInput.parse(await body(request));
    if (!verifyPassword(password)) throw new HttpError(401, "Incorrect password.");
    return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie() });
  }
  if (path === "/api/auth/logout" && method === "POST") return json({ authenticated: false }, 200, { "Set-Cookie": sessionCookie(true) });

  if (path === "/api/state" && method === "GET") {
    requireAdmin(request);
    const db = await store();
    const [brands, orders, activity] = await Promise.all([db.brands(), db.orders(), db.activity()]);
    const state: AppState = { brands, orders, activity, environment: { demo: demoMode(), liveEnabled: publicPaymentEnabled(), credentialsConfigured: authConfigured() && encryptionConfigured(), authenticated: authenticated(request) } };
    return json(state);
  }
  if (path === "/api/brands" && method === "POST") {
    requireAdmin(request); rateLimit("brand-create", 60, 60000);
    return json(await (await store()).createBrand(await body(request)), 201);
  }

  const customerCheckout = path.match(/^\/api\/checkout\/([a-z0-9-]+)\/(quote|payment-start|status)$/);
  if (customerCheckout) {
    if (!authConfigured() && !demoMode()) throw new HttpError(503, "This deployment is not configured for checkout.");
    const [, slug, action] = customerCheckout;
    const db = await store();
    if (action === "quote" && method === "POST") {
      rateLimit("customer-checkout-quote", 120, 60000);
      return json(await quoteCustomerCheckout(db, slug, await body(request)));
    }
    if (action === "payment-start" && method === "POST") {
      rateLimit("customer-payment-start", 30, 60000);
      const key = request.headers.get("idempotency-key") ?? "";
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(422, "Use an 8–100 character alphanumeric idempotency key.");
      return json(await startCustomerCheckoutPayment(db, slug, await body(request), key, site.origin), 201);
    }
    if (action === "status" && method === "GET") {
      rateLimit("customer-payment-status", 240, 60000);
      const receipt = url.searchParams.get("receipt") ?? "";
      return json(await customerPaymentStatus(db, slug, receipt));
    }
    throw new HttpError(405, "Method not allowed.");
  }

  const checkout = path.match(/^\/api\/checkout\/([a-z0-9-]+)$/);
  if (checkout && (method === "GET" || method === "POST")) {
    if (!authConfigured() && !demoMode()) throw new HttpError(503, "This deployment is not configured for checkout.");
    const slug = checkout[1]; const db = await store(); const brand = await db.brand(slug, true);
    const allowDraft = site.kind === "admin" && (authenticated(request) || demoMode());
    if (brand.status !== "live" && !allowDraft) throw new HttpError(404, "Checkout is not published.");
    if (method === "GET") return json(publicBrand(brand));
    rateLimit("checkout", 120, 60000);
    const key = request.headers.get("idempotency-key") ?? undefined;
    if (key && !/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new HttpError(422, "Use an 8–100 character alphanumeric idempotency key.");
    return json(await db.checkout(slug, await body(request), allowDraft, key), 201);
  }
  const brandRoute = path.match(/^\/api\/brands\/([a-zA-Z0-9_-]+)(?:\/(connections|products\/sync|products|publish|payment-quote|launch-quote|payment-start|payment-reconcile|launch-readiness|launch-acceptance))?$/);
  if (brandRoute) {
    const [, brandId, action] = brandRoute;
    requireAdmin(request);
    if (action === "launch-readiness" && method === "GET") {
      requireCredentials(request);
      return json(await launchReadiness(await store(), brandId));
    }
    if (action === "launch-acceptance" && method === "POST") {
      requireCredentials(request); rateLimit("launch-acceptance", 10, 60000);
      const input = z.object({ attemptId: z.string().regex(/^attempt_[0-9a-f-]{36}$/) }).strict().parse(await body(request));
      return json(await recordLaunchAcceptance(await store(), brandId, input.attemptId), 201);
    }
    if (action === "payment-start" && method === "POST") {
      requireCredentials(request); rateLimit("payment-start", 10, 60000);
      return json(await startPayment(await store(), brandId, await body(request), request.headers.get("idempotency-key") ?? "", `${site.origin}/`));
    }
    if (action === "payment-reconcile" && method === "POST") {
      requireCredentials(request); rateLimit("payment-reconcile", 20, 60000);
      const input = z.object({ attemptId: z.string().regex(/^attempt_[a-zA-Z0-9-]+$/), paymentId: z.string().regex(/^pay_[a-zA-Z0-9]+$/) }).strict().parse(await body(request));
      return json(await reconcilePayment(await store(), brandId, input.attemptId, input.paymentId));
    }
    if ((action === "payment-quote" || action === "launch-quote") && method === "POST") {
      requireCredentials(request); rateLimit("payment-quote", 10, 60000);
      const db = await store(); const brand = await db.brand(brandId);
      const credentials = await db.credential<ShopifyCredentials>(brandId, "shopify");
      const result = await (action === "launch-quote" ? calculateLaunchQuote : calculatePaymentQuote)(brand, credentials, await body(request));
      const current = await db.credential<ShopifyCredentials>(brandId, "shopify");
      if (!sameShopifyCredentials(current, credentials)) throw new HttpError(409, "Connection changed during calculation. Request a new calculation.");
      if (action === "launch-quote" && JSON.stringify(await db.brand(brandId)) !== JSON.stringify(brand)) throw new HttpError(409, "Brand settings or catalog changed during calculation. Request a new calculation.");
      return json(result);
    }
    if (!action && method === "PATCH") return json(await (await store()).updateBrand(brandId, await body(request)));
    if (action === "products" && method === "POST") {
      rateLimit("test-product-create", 60, 60000);
      return json(await (await store()).addTestProduct(brandId, await body(request)), 201);
    }
    if (action === "publish" && method === "POST") {
      const input = publishInput.parse(await body(request));
      if (input.mode === "live") {
        requireCredentials(request); rateLimit("live-activation", 5, 60000);
        return json(await activateLiveCheckout(await store(), brandId));
      }
      return json(await (await store()).publish(brandId, "demo"));
    }
    if (action === "connections" && method === "POST") {
      requireCredentials(request); rateLimit("connections", 20, 60000);
      const input = connectionInput.parse(await body(request)); const db = await store(); await db.brand(brandId);
      const account = input.provider === "shopify" ? await verifyShopify(input) : await verifyWhop(input.companyId, input.apiKey);
      return json(await db.transaction(async () => {
        const brand = await db.brand(brandId);
        await db.setCredential(brandId, input.provider, input);
        brand.accountDetails = {
          ...accountDetails(brand),
          ...(input.provider === "shopify" ? { shopifyDomain: account } : { whopCompanyId: account }),
        };
        brand[input.provider] = { status: "verified", account, checkedAt: new Date().toISOString() };
        if (input.provider === "shopify") {
          brand.products = []; brand.status = "draft";
        }
        await db.saveBrand(brand); await db.addActivity(`${brand.name}: ${input.provider} API access verified (not live payments)`, "connection", brand.id);
        return brand;
      }));
    }
    if (action === "products/sync" && method === "POST") {
      requireCredentials(request); rateLimit("product-sync", 5, 60000);
      const db = await store(); await db.brand(brandId);
      const credentials = await db.credential<ShopifyCredentials>(brandId, "shopify");
      const products = await syncShopify(credentials);
      return json(await db.transaction(async () => {
        const current = await db.credential<ShopifyCredentials>(brandId, "shopify");
        if (!sameShopifyCredentials(current, credentials)) throw new HttpError(409, "Connection changed during import. Sync again.");
        const brand = await db.brand(brandId); brand.products = products;
        if (!products.some(p => p.available)) brand.status = "draft";
        brand.shopify = { ...brand.shopify, status: "verified", checkedAt: new Date().toISOString() };
        await db.saveBrand(brand); await db.addActivity(`${products.length} Shopify variants imported for ${brand.name}`, "connection", brandId);
        return brand;
      }));
    }
  }
  throw new HttpError(404, "API endpoint not found.");
}

const handler = route(handleApi);
export { handler as state, handler as addBrand, handler as editBrand, handler as connect, handler as syncProducts, handler as publish, handler as paymentQuote, handler as checkoutGet, handler as checkoutPost, handler as customerCheckout, handler as authStatus, handler as csrf, handler as login, handler as logout };
