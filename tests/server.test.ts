import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../lib/server/store";
import { authenticated, authConfigured, checkOrigin, decrypt, demoMode, encrypt, requireAdmin, requireCredentials, sessionCookie, verifyPassword } from "../lib/server/security";
import { route, body } from "../lib/server/http";
import { syncShopify, verifyShopify, verifyWhop } from "../lib/server/providers";
import { handleApi } from "../lib/server/api";
import { scryptSync } from "node:crypto";
import { rateLimit } from "../lib/server/security";

const customer = { email: "test@example.com", firstName: "Demo", lastName: "Buyer", address: "123 Example Street", city: "Portland", postalCode: "97201", country: "US" };
const order = { mode: "demo", items: [{ productId: "product_1", quantity: 1 }], customer };
const request = (path = "/api/state", options: RequestInit = {}) => new Request(`http://localhost:3000${path}`, options);

function environment(values: Record<string, string | undefined>, fn: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fn(); } finally { for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test("seed is accurate, synthetic, and durable across database reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "limitless-")); const path = join(dir, "test.sqlite");
  try {
    let db = new Store(path);
    assert.deepEqual(db.brands().map(b => b.slug), ["aure-studio", "form-and-field", "everyday-supply"]);
    assert.equal(db.orders().length, 8);
    for (const brand of db.brands()) { assert.equal(brand.mode, "demo"); assert.equal(brand.status, "draft"); assert.equal(brand.shopify.status, "not_connected"); assert.equal(brand.whop.status, "not_connected"); }
    for (const item of db.orders()) { assert.equal(item.mode, "demo"); assert.equal(item.syncStatus, "demo"); assert.match(item.email, /@example.com$/); }
    const brand = db.createBrand({ name: "My Brand", category: "Home", domain: "brand.example", accent: "#123456" });
    db.updateBrand(brand.id, { announcement: "Saved persistently" }); db.db.close();
    db = new Store(path);
    assert.equal(db.brands().length, 4); assert.equal(db.orders().length, 8);
    assert.equal(db.brand(brand.id).announcement, "Saved persistently"); db.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("brand validation blocks mass assignment and creates stable unique slugs", () => {
  const db = new Store(":memory:");
  try {
    assert.throws(() => db.createBrand({ name: "", category: "Home" }));
    assert.throws(() => db.createBrand({ name: "Bad", category: "Home", domain: "https://example.com/path" }));
    assert.throws(() => db.updateBrand("brand_1", { status: "live", products: [] }));
    assert.throws(() => db.updateBrand("brand_1", { shippingPrice: 1.001 }));
    assert.throws(() => db.updateBrand("brand_1", { accent: "red;background:url(evil)" }));
    assert.throws(() => db.updateBrand("brand_1", {}));
    db.updateBrand("brand_1", { announcement: "Updated" });
    assert.equal(db.brand("brand_1").accent, "#3c5143");
    const first = db.createBrand({ name: "Auré Studio", category: "Skincare" });
    const second = db.createBrand({ name: "Auré Studio", category: "Skincare" });
    assert.equal(first.slug, "aure-studio-2"); assert.equal(second.slug, "aure-studio-3");
    assert.equal(first.status, "draft"); assert.equal(first.mode, "demo");
    assert.throws(() => db.publish(first.id, "demo"), /available product/);
    assert.throws(() => db.publish("brand_1", "live"), /Live checkout is not enabled/);
  } finally { db.db.close(); }
});

test("checkout computes price and shipping in cents, persists orders, and handles replay atomically", () => {
  const db = new Store(":memory:");
  try {
    assert.throws(() => db.checkout("aure-studio", order, false), /not published/);
    db.publish("brand_1", "demo");
    const result = db.checkout("aure-studio", order, false, "test-key-one");
    assert.equal(result.total, 53); assert.equal(result.mode, "demo");
    assert.equal(db.orders().length, 9);
    assert.deepEqual(db.checkout("aure-studio", order, false, "test-key-one"), result);
    assert.equal(db.orders().length, 9);
    assert.throws(() => db.checkout("aure-studio", { ...order, customer: { ...customer, firstName: "Other" } }, false, "test-key-one"), /different order/);
    assert.equal(db.checkout("aure-studio", { ...order, items: [{ productId: "product_1", quantity: 2 }] }, false).total, 96);
    const brand = db.brand("brand_1"); brand.products[0].price = 0.1; db.saveBrand(brand);
    db.updateBrand(brand.id, { shippingPrice: 0.2, freeShippingThreshold: 100 });
    assert.equal(db.checkout(brand.slug, { ...order, items: [{ productId: "product_1", quantity: 3 }] }, false).total, 0.5);
    const fingerprint = db.db.prepare("SELECT fingerprint FROM idempotency").get()!.fingerprint as string;
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
  } finally { db.db.close(); }
});

test("checkout rejects malformed, duplicate, unavailable, and client-priced orders", () => {
  const db = new Store(":memory:");
  try {
    for (const items of [[], [{ productId: "product_1", quantity: 0 }], [{ productId: "product_1", quantity: -2 }], [{ productId: "product_1", quantity: 1.5 }], [{ productId: "product_1", quantity: 21 }], [{ productId: "missing", quantity: 1 }], [{ productId: "product_1", quantity: 1, price: 0 }], [{ productId: "product_1", quantity: 1 }, { productId: "product_1", quantity: 2 }]]) {
      assert.throws(() => db.checkout("aure-studio", { ...order, items }, true));
    }
    assert.throws(() => db.checkout("aure-studio", { ...order, total: 0 }, true));
    assert.throws(() => db.checkout("aure-studio", { ...order, mode: "live" }, true));
    assert.throws(() => db.checkout("aure-studio", { ...order, customer: { ...customer, email: "invalid" } }, true));
    const brand = db.brand("brand_1"); brand.products[0].available = false; db.saveBrand(brand);
    assert.throws(() => db.checkout("aure-studio", order, true), /unavailable/);
    assert.equal(db.orders().length, 8);
  } finally { db.db.close(); }
});

test("auth fails closed in production and public demo cannot submit credentials", () => {
  environment({ NODE_ENV: "development", ADMIN_PASSWORD: undefined, ADMIN_PASSWORD_HASH: undefined, SESSION_SECRET: undefined }, () => {
    assert.equal(demoMode(), true); assert.doesNotThrow(() => requireAdmin(request()));
    assert.throws(() => requireCredentials(request()), /disabled in the public demo/);
  });
  environment({ NODE_ENV: "production", ADMIN_PASSWORD: undefined, ADMIN_PASSWORD_HASH: undefined, SESSION_SECRET: undefined }, () => {
    assert.equal(demoMode(), false); assert.equal(authConfigured(), false);
    assert.throws(() => requireAdmin(request()), /not configured/);
  });
  environment({ NODE_ENV: "production", ADMIN_PASSWORD: "strong-test-password-123!", ADMIN_PASSWORD_HASH: undefined, SESSION_SECRET: "s".repeat(48), CREDENTIAL_ENCRYPTION_KEY: "ab".repeat(32) }, () => {
    assert.equal(authConfigured(), true); assert.equal(demoMode(), false);
    assert.equal(verifyPassword("wrong"), false); assert.equal(verifyPassword("strong-test-password-123!"), true);
    assert.throws(() => requireAdmin(request()), /Sign in/);
    const cookie = sessionCookie(); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
    assert.equal(authenticated(request("/api/state", { headers: { cookie } })), true);
    assert.equal(authenticated(request("/api/state", { headers: { cookie: cookie.replace(/limitless_session=./, "limitless_session=0") } })), false);
    assert.equal(authenticated(request("/api/state", { headers: { cookie: sessionCookie(true) } })), false);
    requireCredentials(request("/api/state", { headers: { cookie } }));
  });
});

test("credentials are authenticated encrypted, contextual, and never stored in plaintext", () => {
  environment({ CREDENTIAL_ENCRYPTION_KEY: "cd".repeat(32) }, () => {
    const encrypted = encrypt("very-secret-token", "brand_1:shopify");
    assert.equal(decrypt(encrypted, "brand_1:shopify"), "very-secret-token");
    assert.notEqual(encrypted, encrypt("very-secret-token", "brand_1:shopify"));
    assert.throws(() => decrypt(encrypted, "brand_2:shopify"));
    const parts = encrypted.split("."); parts[2] = Buffer.from("tampered").toString("base64url"); assert.throws(() => decrypt(parts.join("."), "brand_1:shopify"));
    const dir = mkdtempSync(join(tmpdir(), "limitless-secrets-")); const path = join(dir, "test.sqlite");
    try {
      const db = new Store(path); db.setCredential("brand_1", "shopify", { accessToken: "very-secret-token" });
      assert.deepEqual(db.credential("brand_1", "shopify"), { accessToken: "very-secret-token" });
      assert.equal(JSON.stringify(db.brands()).includes("very-secret-token"), false);
      db.db.close(); assert.equal(readFileSync(path).includes(Buffer.from("very-secret-token")), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test("password hashes take precedence, sessions expire, and partial auth never enables public demo", () => {
  const salt = "ab".repeat(16);
  const password = "a-long-random-admin-password";
  const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  environment({ NODE_ENV: "development", ADMIN_PASSWORD_HASH: hash, ADMIN_PASSWORD: "different-long-password", SESSION_SECRET: "s".repeat(48), CREDENTIAL_ENCRYPTION_KEY: undefined }, () => {
    assert.equal(verifyPassword(password), true);
    assert.equal(verifyPassword("different-long-password"), false);
    const now = Date.now(); const cookie = sessionCookie(false, now);
    assert.equal(authenticated(request("/api/state", { headers: { cookie } }), now + 8 * 60 * 60 * 1000), false);
    process.env.ADMIN_PASSWORD_HASH = "malformed";
    assert.equal(authConfigured(), false); assert.equal(demoMode(), false);
    assert.equal(verifyPassword("different-long-password"), false);
  });
  environment({ NODE_ENV: "development", ADMIN_PASSWORD_HASH: undefined, ADMIN_PASSWORD: undefined, SESSION_SECRET: "partial", CREDENTIAL_ENCRYPTION_KEY: undefined }, () => {
    assert.equal(demoMode(), false); assert.throws(() => requireAdmin(request()), /not configured/);
  });
});

test("rate limits reject exhausted buckets until expiry", () => {
  rateLimit("test-bucket", 2, 1000, 100);
  rateLimit("test-bucket", 2, 1000, 101);
  assert.throws(() => rateLimit("test-bucket", 2, 1000, 102), /Too many/);
  assert.doesNotThrow(() => rateLimit("test-bucket", 2, 1000, 1100));
});

test("production mutation origin configuration requires HTTPS and an exact origin", () => {
  for (const origin of [undefined, "http://example.com", "https://example.com/path"]) {
    environment({ NODE_ENV: "production", APP_URL: origin }, () => {
      assert.throws(() => checkOrigin(request("/api/brands", { method: "POST", headers: { origin: "https://example.com", "content-type": "application/json" } })), /Configure APP_URL/);
    });
  }
  environment({ NODE_ENV: "production", APP_URL: "https://example.com" }, () => {
    checkOrigin(request("/api/brands", { method: "POST", headers: { host: "example.com", origin: "https://example.com", "content-type": "application/json; charset=utf-8" } }));
    assert.throws(() => checkOrigin(request("/api/brands", { method: "POST", headers: { host: "example.com", origin: "https://example.com", "content-type": "application/json-fake" } })), /application\/json/);
  });
});

test("mutations enforce exact origin and JSON; request body is bounded", async () => {
  environment({ NODE_ENV: "development", APP_URL: "http://localhost:3000" }, () => {
    assert.throws(() => checkOrigin(request("/api/brands", { method: "POST" })), /origin/);
    assert.throws(() => checkOrigin(request("/api/brands", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" } })), /origin/);
    assert.throws(() => checkOrigin(request("/api/brands", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "text/plain" } })), /application\/json/);
    checkOrigin(request("/api/brands", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" } }));
  });
  await assert.rejects(body(request("/api/brands", { method: "POST", body: "x".repeat(33000) })), /too large/);
  await assert.rejects(body(request("/api/brands", { method: "POST", body: "{" })), /Invalid JSON/);
  const response = await route(async () => { throw new Error("secret-database-password"); })(request());
  assert.equal(response.status, 500); assert.equal((await response.text()).includes("secret-database-password"), false);
});

test("provider verification rejects bad credentials, mismatched accounts, and unsafe domains", async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ id: "biz_selected" }); };
    assert.equal(await verifyWhop("biz_selected", "private-key"), "biz_selected");
    await assert.rejects(verifyWhop("biz_other", "private-key"), /different company/);
    globalThis.fetch = async () => Response.json({ error: "private-provider-detail" }, { status: 401 });
    await assert.rejects(verifyWhop("biz_selected", "bad"), /rejected these credentials/);
    await assert.rejects(verifyShopify({ domain: "127.0.0.1", accessToken: "key" }), /permanent/);
    assert.equal(calls, 2);
    globalThis.fetch = async () => Response.json({ data: { shop: { name: "Test", myshopifyDomain: "test.myshopify.com", currencyCode: "USD" }, currentAppInstallation: { accessScopes: [{ handle: "read_products" }, { handle: "read_inventory" }] } } });
    assert.equal(await verifyShopify({ domain: "test.myshopify.com", accessToken: "key" }), "test.myshopify.com");
    await assert.rejects(verifyShopify({ domain: "other.myshopify.com", accessToken: "key" }), /did not match/);
  } finally { globalThis.fetch = original; }
});

test("Shopify imports each variant with availability and no unsafe image URL", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.redirect, "error");
      const query = JSON.parse(init?.body as string).query as string;
      if (query.includes("currentAppInstallation")) return Response.json({ data: { shop: { name: "Test", myshopifyDomain: "test.myshopify.com", currencyCode: "USD" }, currentAppInstallation: { accessScopes: [{ handle: "read_products" }, { handle: "read_inventory" }] } } });
      return Response.json({ data: { productVariants: { nodes: [{ id: "gid://shopify/ProductVariant/1", title: "Small", price: "19.99", compareAtPrice: "24.99", inventoryQuantity: 0, inventoryPolicy: "DENY", inventoryItem: { tracked: true }, image: { url: "https://evil.example/tracker" }, product: { title: "Tee", description: "Soft tee", status: "ACTIVE", featuredImage: null } }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    };
    const products = await syncShopify({ domain: "test.myshopify.com", accessToken: "key" });
    assert.equal(products.length, 1); assert.equal(products[0].title, "Tee · Small"); assert.equal(products[0].price, 19.99); assert.equal(products[0].available, false); assert.equal(products[0].image, undefined);
  } finally { globalThis.fetch = original; }
});

test("development uses the actual Host while production still requires its configured origin", () => {
  environment({ NODE_ENV: "development", APP_URL: undefined }, () => {
    const normalized = (origin: string) => new Request("http://0.0.0.0:3000/api/brands", { method: "POST", headers: { host: "localhost:3000", origin, "Content-Type": "application/json" }, body: "{}" });
    assert.doesNotThrow(() => checkOrigin(normalized("http://localhost:3000")));
    assert.throws(() => checkOrigin(normalized("https://evil.example")), /origin must match/);
  });
  environment({ NODE_ENV: "production", APP_URL: "https://checkout.example" }, () => {
    const forged = new Request("http://0.0.0.0:3000/api/brands", { method: "POST", headers: { host: "evil.example", origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
    assert.throws(() => checkOrigin(forged), /Site not configured/);
  });
});

test("production APIs protect admin state and public drafts, sanitize account identities", async () => {
  const old = { NODE_ENV: process.env.NODE_ENV, APP_URL: process.env.APP_URL, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH, SESSION_SECRET: process.env.SESSION_SECRET };
  const globals = globalThis as typeof globalThis & { limitlessStore?: Store };
  const previousStore = globals.limitlessStore; const db = new Store(":memory:"); globals.limitlessStore = db;
  try {
    Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://dashboard.example", ADMIN_PASSWORD: "strong-password-test-123!", SESSION_SECRET: "s".repeat(48) }); delete process.env.ADMIN_PASSWORD_HASH;
    const handler = route(handleApi);
    const request = (path = "/api/state", options: RequestInit = {}) => new Request(`https://dashboard.example${path}`, options);
    assert.equal((await handler(request())).status, 401);
    assert.equal((await handler(request("/api/checkout/aure-studio"))).status, 404);
    db.publish("brand_1", "demo");
    const brand = db.brand("brand_1"); brand.shopify = { status: "verified", account: "private.myshopify.com", checkedAt: new Date().toISOString() }; db.saveBrand(brand);
    const response = await handler(request("/api/checkout/aure-studio"));
    assert.equal(response.status, 200); const publicData = await response.json();
    assert.equal(publicData.shopify.account, undefined); assert.equal(publicData.shopify.checkedAt, undefined);
    assert.equal((await handler(request("/api/state", { headers: { cookie: sessionCookie() } }))).status, 200);
  } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    globals.limitlessStore = previousStore; db.db.close();
  }
});
