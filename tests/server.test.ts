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

async function environment(values: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { await fn(); } finally { for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test("seed is accurate, synthetic, and durable across database reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "limitless-")); const path = join(dir, "test.sqlite");
  try {
    let db = new Store(path);
    await db.ready;
    assert.deepEqual((await db.brands()).map(b => b.slug), ["aure-studio", "form-and-field", "everyday-supply"]);
    assert.equal((await db.orders()).length, 8);
    for (const brand of await db.brands()) { assert.equal(brand.mode, "demo"); assert.equal(brand.status, "draft"); assert.equal(brand.shopify.status, "not_connected"); assert.equal(brand.whop.status, "not_connected"); }
    for (const item of await db.orders()) { assert.equal(item.mode, "demo"); assert.equal(item.syncStatus, "demo"); assert.match(item.email, /@example.com$/); }
    const brand = await db.createBrand({ name: "My Brand", category: "Home", domain: "brand.example", accent: "#123456" });
    await db.updateBrand(brand.id, { announcement: "Saved persistently" }); db.db.close();
    db = new Store(path);
    await db.ready;
    assert.equal((await db.brands()).length, 4); assert.equal((await db.orders()).length, 8);
    assert.equal((await db.brand(brand.id)).announcement, "Saved persistently"); db.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("brand validation blocks mass assignment and creates stable unique slugs", async () => {
  const db = new Store(":memory:");
  await db.ready;
  try {
    await assert.rejects(async () => await db.createBrand({ name: "", category: "Home" }));
    await assert.rejects(async () => await db.createBrand({ name: "Bad", category: "Home", domain: "https://example.com/path" }));
    await assert.rejects(async () => await db.updateBrand("brand_1", { status: "live", products: [] }));
    await assert.rejects(async () => await db.updateBrand("brand_1", { shippingPrice: 1.001 }));
    await assert.rejects(async () => await db.updateBrand("brand_1", { accent: "red;background:url(evil)" }));
    await assert.rejects(async () => await db.updateBrand("brand_1", {}));
    await db.updateBrand("brand_1", { announcement: "Updated" });
    assert.equal((await db.brand("brand_1")).accent, "#3c5143");
    const first = await db.createBrand({ name: "Auré Studio", category: "Skincare" });
    const second = await db.createBrand({ name: "Auré Studio", category: "Skincare" });
    assert.equal(first.slug, "aure-studio-2"); assert.equal(second.slug, "aure-studio-3");
    assert.equal(first.status, "draft"); assert.equal(first.mode, "demo");
    await assert.rejects(async () => await db.publish(first.id, "demo"), /available product/);
    await assert.rejects(async () => await db.publish("brand_1", "live"), /Live checkout is not enabled/);
  } finally { db.db.close(); }
});

test("checkout computes price and shipping in cents, persists orders, and handles replay atomically", async () => {
  const db = new Store(":memory:");
  await db.ready;
  try {
    await assert.rejects(async () => await db.checkout("aure-studio", order, false), /not published/);
    await db.publish("brand_1", "demo");
    const result = await db.checkout("aure-studio", order, false, "test-key-one");
    assert.equal(result.total, 53); assert.equal(result.mode, "demo");
    assert.equal((await db.orders()).length, 9);
    assert.deepEqual(await db.checkout("aure-studio", order, false, "test-key-one"), result);
    assert.equal((await db.orders()).length, 9);
    await assert.rejects(async () => await db.checkout("aure-studio", { ...order, customer: { ...customer, firstName: "Other" } }, false, "test-key-one"), /different order/);
    assert.equal((await db.checkout("aure-studio", { ...order, items: [{ productId: "product_1", quantity: 2 }] }, false)).total, 96);
    const brand = await db.brand("brand_1"); brand.products[0].price = 0.1; await db.saveBrand(brand);
    await db.updateBrand(brand.id, { shippingPrice: 0.2, freeShippingThreshold: 100 });
    assert.equal((await db.checkout(brand.slug, { ...order, items: [{ productId: "product_1", quantity: 3 }] }, false)).total, 0.5);
    const fingerprint = db.db.prepare("SELECT fingerprint FROM idempotency").get()!.fingerprint as string;
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
  } finally { db.db.close(); }
});

test("checkout rejects malformed, duplicate, unavailable, and client-priced orders", async () => {
  const db = new Store(":memory:");
  await db.ready;
  try {
    for (const items of [[], [{ productId: "product_1", quantity: 0 }], [{ productId: "product_1", quantity: -2 }], [{ productId: "product_1", quantity: 1.5 }], [{ productId: "product_1", quantity: 21 }], [{ productId: "missing", quantity: 1 }], [{ productId: "product_1", quantity: 1, price: 0 }], [{ productId: "product_1", quantity: 1 }, { productId: "product_1", quantity: 2 }]]) {
      await assert.rejects(async () => await db.checkout("aure-studio", { ...order, items }, true));
    }
    await assert.rejects(async () => await db.checkout("aure-studio", { ...order, total: 0 }, true));
    await assert.rejects(async () => await db.checkout("aure-studio", { ...order, mode: "live" }, true));
    await assert.rejects(async () => await db.checkout("aure-studio", { ...order, customer: { ...customer, email: "invalid" } }, true));
    const brand = await db.brand("brand_1"); brand.products[0].available = false; await db.saveBrand(brand);
    await assert.rejects(async () => await db.checkout("aure-studio", order, true), /unavailable/);
    assert.equal((await db.orders()).length, 8);
  } finally { db.db.close(); }
});

test("SQLite retains both concurrent catalog updates and their activity", async () => {
  const db = new Store(":memory:");
  await db.ready;
  try {
    const original = await db.brand("brand_1");
    const activityBefore = await db.activity();
    await Promise.all([
      db.addTestProduct(original.id, { title: "Concurrent candle", price: 12 }),
      db.addTestProduct(original.id, { title: "Concurrent pouch", price: 15 }),
    ]);
    const saved = await db.brand(original.id);
    assert.deepEqual(saved.products.slice(0, original.products.length), original.products);
    assert.deepEqual(saved.products.slice(original.products.length).map(product => product.title).sort(), ["Concurrent candle", "Concurrent pouch"]);
    assert.equal(new Set(saved.products.map(product => product.id)).size, original.products.length + 2);
    const addedActivity = (await db.activity()).filter(item => !activityBefore.some(previous => previous.id === item.id));
    assert.equal(addedActivity.length, 2);
    assert.equal(addedActivity.every(item => item.brandId === original.id && item.type === "brand"), true);
  } finally { db.db.close(); }
});

test("SQLite concurrent idempotent checkouts create only one order and activity", async () => {
  const db = new Store(":memory:");
  await db.ready;
  try {
    await db.publish("brand_1", "demo");
    const ordersBefore = await db.orders();
    const activityBefore = await db.activity();
    const [first, second] = await Promise.all([
      db.checkout("aure-studio", order, false, "concurrent-checkout"),
      db.checkout("aure-studio", order, false, "concurrent-checkout"),
    ]);
    assert.deepEqual(first, second);
    assert.equal(first.total, 53);
    const savedOrders = await db.orders();
    assert.equal(savedOrders.length, ordersBefore.length + 1);
    assert.equal(savedOrders.filter(item => item.id === first.orderId).length, 1);
    assert.equal((await db.activity()).length, activityBefore.length + 1);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM idempotency").get()?.n, 1);
  } finally { db.db.close(); }
});

test("SQLite rolls back async transaction writes and accepts subsequent transactions", async () => {
  const db = new Store(":memory:");
  await db.ready;
  try {
    const original = await db.brand("brand_1");
    const activityBefore = await db.activity();
    const failure = new Error("Synthetic transaction failure");
    await assert.rejects(db.transaction(async () => {
      await db.saveBrand({ ...original, announcement: "Must be rolled back" });
      await db.addActivity("Must be rolled back", "brand", original.id);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal((await db.brand(original.id)).announcement, "Must be rolled back");
      assert.equal((await db.activity()).length, activityBefore.length + 1);
      throw failure;
    }), error => error === failure);
    assert.deepEqual(await db.brand(original.id), original);
    assert.deepEqual(await db.activity(), activityBefore);
    await db.updateBrand(original.id, { announcement: "Saved after rollback" });
    assert.equal((await db.brand(original.id)).announcement, "Saved after rollback");
  } finally { db.db.close(); }
});

test("auth fails closed in production and public demo cannot submit credentials", async () => {
  await environment({ NODE_ENV: "development", ADMIN_PASSWORD: undefined, ADMIN_PASSWORD_HASH: undefined, SESSION_SECRET: undefined }, () => {
    assert.equal(demoMode(), true); assert.doesNotThrow(() => requireAdmin(request()));
    assert.throws(() => requireCredentials(request()), /disabled in the public demo/);
  });
  await environment({ NODE_ENV: "production", ADMIN_PASSWORD: undefined, ADMIN_PASSWORD_HASH: undefined, SESSION_SECRET: undefined }, () => {
    assert.equal(demoMode(), false); assert.equal(authConfigured(), false);
    assert.throws(() => requireAdmin(request()), /not configured/);
  });
  await environment({ NODE_ENV: "production", ADMIN_PASSWORD: "strong-test-password-123!", ADMIN_PASSWORD_HASH: undefined, SESSION_SECRET: "s".repeat(48), CREDENTIAL_ENCRYPTION_KEY: "ab".repeat(32) }, () => {
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

test("credentials are authenticated encrypted, contextual, and never stored in plaintext", async () => {
  await environment({ CREDENTIAL_ENCRYPTION_KEY: "cd".repeat(32) }, async () => {
    const encrypted = encrypt("very-secret-token", "brand_1:shopify");
    assert.equal(decrypt(encrypted, "brand_1:shopify"), "very-secret-token");
    assert.notEqual(encrypted, encrypt("very-secret-token", "brand_1:shopify"));
    assert.throws(() => decrypt(encrypted, "brand_2:shopify"));
    const parts = encrypted.split("."); parts[2] = Buffer.from("tampered").toString("base64url"); assert.throws(() => decrypt(parts.join("."), "brand_1:shopify"));
    const dir = mkdtempSync(join(tmpdir(), "limitless-secrets-")); const path = join(dir, "test.sqlite");
    try {
      const db = new Store(path); await db.ready; await db.setCredential("brand_1", "shopify", { accessToken: "very-secret-token" });
      assert.deepEqual(await db.credential("brand_1", "shopify"), { accessToken: "very-secret-token" });
      assert.equal(JSON.stringify(await db.brands()).includes("very-secret-token"), false);
      db.db.close(); assert.equal(readFileSync(path).includes(Buffer.from("very-secret-token")), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test("password hashes take precedence, sessions expire, and partial auth never enables public demo", async () => {
  const salt = "ab".repeat(16);
  const password = "a-long-random-admin-password";
  const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  await environment({ NODE_ENV: "development", ADMIN_PASSWORD_HASH: hash, ADMIN_PASSWORD: "different-long-password", SESSION_SECRET: "s".repeat(48), CREDENTIAL_ENCRYPTION_KEY: undefined }, () => {
    assert.equal(verifyPassword(password), true);
    assert.equal(verifyPassword("different-long-password"), false);
    const now = Date.now(); const cookie = sessionCookie(false, now);
    assert.equal(authenticated(request("/api/state", { headers: { cookie } }), now + 8 * 60 * 60 * 1000), false);
    process.env.ADMIN_PASSWORD_HASH = "malformed";
    assert.equal(authConfigured(), false); assert.equal(demoMode(), false);
    assert.equal(verifyPassword("different-long-password"), false);
  });
  await environment({ NODE_ENV: "development", ADMIN_PASSWORD_HASH: undefined, ADMIN_PASSWORD: undefined, SESSION_SECRET: "partial", CREDENTIAL_ENCRYPTION_KEY: undefined }, () => {
    assert.equal(demoMode(), false); assert.throws(() => requireAdmin(request()), /not configured/);
  });
});

test("rate limits reject exhausted buckets until expiry", () => {
  rateLimit("test-bucket", 2, 1000, 100);
  rateLimit("test-bucket", 2, 1000, 101);
  assert.throws(() => rateLimit("test-bucket", 2, 1000, 102), /Too many/);
  assert.doesNotThrow(() => rateLimit("test-bucket", 2, 1000, 1100));
});

test("production mutation origin configuration requires HTTPS and an exact origin", async () => {
  for (const origin of [undefined, "http://example.com", "https://example.com/path"]) {
    await environment({ NODE_ENV: "production", APP_URL: origin }, () => {
      assert.throws(() => checkOrigin(request("/api/brands", { method: "POST", headers: { origin: "https://example.com", "content-type": "application/json" } })), /Configure APP_URL/);
    });
  }
  await environment({ NODE_ENV: "production", APP_URL: "https://example.com" }, () => {
    checkOrigin(request("/api/brands", { method: "POST", headers: { host: "example.com", origin: "https://example.com", "content-type": "application/json; charset=utf-8" } }));
    assert.throws(() => checkOrigin(request("/api/brands", { method: "POST", headers: { host: "example.com", origin: "https://example.com", "content-type": "application/json-fake" } })), /application\/json/);
  });
});

test("mutations enforce exact origin and JSON; request body is bounded", async () => {
  await environment({ NODE_ENV: "development", APP_URL: "http://localhost:3000" }, () => {
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
    await assert.rejects(verifyShopify({ domain: "other.myshopify.com", accessToken: "key" }), /Shopify identifies this store as test\.myshopify\.com, but you entered other\.myshopify\.com/);
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

test("development uses the actual Host while production still requires its configured origin", async () => {
  await environment({ NODE_ENV: "development", APP_URL: undefined }, () => {
    const normalized = (origin: string) => new Request("http://0.0.0.0:3000/api/brands", { method: "POST", headers: { host: "localhost:3000", origin, "Content-Type": "application/json" }, body: "{}" });
    assert.doesNotThrow(() => checkOrigin(normalized("http://localhost:3000")));
    assert.throws(() => checkOrigin(normalized("https://evil.example")), /origin must match/);
  });
  await environment({ NODE_ENV: "production", APP_URL: "https://checkout.example" }, () => {
    const forged = new Request("http://0.0.0.0:3000/api/brands", { method: "POST", headers: { host: "evil.example", origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
    assert.throws(() => checkOrigin(forged), /Site not configured/);
  });
});

test("production APIs protect admin state and public drafts, sanitize account identities", async () => {
  const old = { NODE_ENV: process.env.NODE_ENV, APP_URL: process.env.APP_URL, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH, SESSION_SECRET: process.env.SESSION_SECRET };
  const globals = globalThis as typeof globalThis & { limitlessStore?: Store };
  const previousStore = globals.limitlessStore; const db = new Store(":memory:"); await db.ready; globals.limitlessStore = db;
  try {
    Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://dashboard.example", ADMIN_PASSWORD: "strong-password-test-123!", SESSION_SECRET: "s".repeat(48) }); delete process.env.ADMIN_PASSWORD_HASH;
    const handler = route(handleApi);
    const request = (path = "/api/state", options: RequestInit = {}) => new Request(`https://dashboard.example${path}`, options);
    assert.equal((await handler(request())).status, 401);
    assert.equal((await handler(request("/api/checkout/aure-studio"))).status, 404);
    await db.publish("brand_1", "demo");
    const brand = await db.brand("brand_1"); brand.shopify = { status: "verified", account: "private.myshopify.com", checkedAt: new Date().toISOString() }; await db.saveBrand(brand);
    const response = await handler(request("/api/checkout/aure-studio"));
    assert.equal(response.status, 200); const publicData = await response.json();
    assert.equal(publicData.shopify.account, undefined); assert.equal(publicData.shopify.checkedAt, undefined);
    assert.equal((await handler(request("/api/state", { headers: { cookie: sessionCookie() } }))).status, 200);
  } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    globals.limitlessStore = previousStore; db.db.close();
  }
});
