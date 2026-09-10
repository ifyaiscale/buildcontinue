import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../lib/server/store";
import { accountDetails } from "../lib/accounts";
import { route } from "../lib/server/http";
import { handleApi } from "../lib/server/api";
import { sessionCookie } from "../lib/server/security";

const details = {
  shopifyDomain: "",
  shopifyAliases: ["original-shop.myshopify.com", "renamed-shop.myshopify.com"],
  whopCompanyId: "",
  storefrontAliases: ["www.brand.example"],
  customerAccountDomain: "account.brand.example",
};

async function withApi(run: (db: Store, call: (path: string, method?: string, payload?: unknown, cookie?: string) => Promise<Response>) => Promise<void>) {
  const keys = ["NODE_ENV", "APP_URL", "ADMIN_PASSWORD", "ADMIN_PASSWORD_HASH", "SESSION_SECRET", "CREDENTIAL_ENCRYPTION_KEY"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const globals = globalThis as typeof globalThis & { limitlessStore?: Store };
  const previousStore = globals.limitlessStore;
  const db = new Store(":memory:");
  await db.ready;
  globals.limitlessStore = db;
  keys.forEach(key => delete process.env[key]);
  Object.assign(process.env, { NODE_ENV: "development" });
  const handler = route(handleApi);
  const call = (path: string, method = "GET", payload?: unknown, cookie?: string) => handler(new Request(`http://localhost:3000${path}`, {
    method,
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }));
  try { await run(db, call); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    globals.limitlessStore = previousStore;
    db.db.close();
  }
}

test("account details keep storefront, Shopify aliases, and Whop IDs distinct without verifying", async () => {
  await withApi(async (db, call) => {
    const response = await call("/api/brands", "POST", { name: "Example Brand", category: "Other", domain: "brand.example", accountDetails: details });
    assert.equal(response.status, 201);
    const brand = await response.json();
    assert.deepEqual(brand.accountDetails, details);
    assert.equal(brand.shopify.status, "not_connected");
    assert.equal(brand.whop.status, "not_connected");
    assert.equal(brand.status, "draft");
    assert.equal(brand.products.length, 0);
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM credentials").get()?.n, 0);
    const updated = await call(`/api/brands/${brand.id}`, "PATCH", { accountDetails: { ...details, shopifyDomain: " ORIGINAL-SHOP.MYSHOPIFY.COM ", whopCompanyId: "biz_Example" } });
    assert.equal(updated.status, 200);
    const saved = await db.brand(brand.id);
    assert.equal(saved.domain, "brand.example");
    assert.equal(saved.accountDetails?.shopifyDomain, "original-shop.myshopify.com");
    assert.equal(saved.accountDetails?.whopCompanyId, "biz_Example");
    assert.equal(saved.shopify.status, "not_connected");
    assert.equal(saved.whop.status, "not_connected");
  });
});

test("identifier validation rejects unsafe URLs, duplicate aliases, secrets, and status injection", async () => {
  const db = new Store(":memory:");
  await db.ready;
  try {
    for (const invalid of [
      { shopifyDomain: "brand.example" },
      { shopifyDomain: "https://shop.myshopify.com" },
      { shopifyDomain: "shop.myshopify.com/path" },
      { shopifyDomain: "shop.myshopify.com.evil.example" },
      { whopCompanyId: "an-api-key-not-a-business-id" },
      { shopifyAliases: ["same.myshopify.com", "SAME.MYSHOPIFY.COM"] },
      { shopifyAliases: [""] },
      { storefrontAliases: ["https://brand.example"] },
      { customerAccountDomain: "javascript:alert(1)" },
      { apiKey: "secret" },
      { accessToken: "secret" },
      { status: "verified" },
    ]) await assert.rejects(async () => await db.updateBrand("brand_1", { accountDetails: { ...details, ...invalid } }));
    assert.equal((await db.brand("brand_1")).accountDetails, undefined);
  } finally { db.db.close(); }
});

test("legacy defaults prefill only API domains, never public storefronts", async () => {
  const db = new Store(":memory:");
  await db.ready;
  try {
    let brand = await db.updateBrand("brand_1", { domain: "brand.example" });
    assert.equal(accountDetails(brand).shopifyDomain, "");
    brand = await db.updateBrand("brand_1", { domain: "legacy.myshopify.com" });
    assert.equal(accountDetails(brand).shopifyDomain, "legacy.myshopify.com");
    brand.shopify = { status: "verified", account: "verified.myshopify.com" };
    brand.whop = { status: "verified", account: "biz_Verified" };
    assert.equal(accountDetails(brand).shopifyDomain, "verified.myshopify.com");
    assert.equal(accountDetails(brand).whopCompanyId, "biz_Verified");
  } finally { db.db.close(); }
});

test("public checkout redacts account metadata and production protects identifier edits", async () => {
  await withApi(async (db, call) => {
    await db.updateBrand("brand_1", { domain: "private-store.example", accountDetails: { ...details, whopCompanyId: "biz_Private" } });
    await db.publish("brand_1", "demo");
    let response = await call("/api/checkout/aure-studio");
    assert.equal(response.status, 200);
    const publicBrand = await response.json();
    assert.equal(publicBrand.accountDetails, undefined);
    assert.equal(publicBrand.domain, "");
    assert.equal(JSON.stringify(publicBrand).includes("biz_Private"), false);
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.APP_URL = "https://checkout.example";
    process.env.ADMIN_PASSWORD = "only-a-test-password";
    process.env.SESSION_SECRET = "s".repeat(32);
    response = await route(handleApi)(new Request("https://checkout.example/api/brands/brand_1", { method: "PATCH", headers: { Origin: "https://checkout.example", "Content-Type": "application/json" }, body: JSON.stringify({ accountDetails: details }) }));
    assert.equal(response.status, 401);
    response = await route(handleApi)(new Request("https://checkout.example/api/state"));
    assert.equal(response.status, 401);
  });
});

test("only successful provider verification changes a verified account mapping", async () => {
  await withApi(async (db, call) => {
    process.env.ADMIN_PASSWORD = "only-a-test-password";
    process.env.SESSION_SECRET = "s".repeat(32);
    process.env.CREDENTIAL_ENCRYPTION_KEY = "a".repeat(64);
    const cookie = sessionCookie().split(";", 1)[0];
    await db.updateBrand("brand_1", { accountDetails: details });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(JSON.stringify({ id: "biz_Original" }), { status: 200 });
      let response = await call("/api/brands/brand_1/connections", "POST", { provider: "whop", companyId: "biz_Original", apiKey: "test-whop-secret" }, cookie);
      assert.equal(response.status, 200);
      assert.equal((await db.brand("brand_1")).accountDetails?.whopCompanyId, "biz_Original");
      assert.deepEqual((await db.brand("brand_1")).accountDetails?.shopifyAliases, details.shopifyAliases);
      await assert.rejects(async () => await db.updateBrand("brand_1", { accountDetails: { ...details, whopCompanyId: "biz_Replacement" } }), /Verify the replacement whop/);
      globalThis.fetch = async () => new Response("denied", { status: 401 });
      response = await call("/api/brands/brand_1/connections", "POST", { provider: "whop", companyId: "biz_Replacement", apiKey: "incorrect-test-secret" }, cookie);
      assert.equal(response.status, 422);
      assert.equal((await db.brand("brand_1")).whop.account, "biz_Original");
      assert.equal((await db.brand("brand_1")).accountDetails?.whopCompanyId, "biz_Original");
      assert.equal((await db.credential<{ apiKey: string }>("brand_1", "whop")).apiKey, "test-whop-secret");
      globalThis.fetch = async () => new Response(JSON.stringify({ id: "biz_Replacement" }), { status: 200 });
      response = await call("/api/brands/brand_1/connections", "POST", { provider: "whop", companyId: "biz_Replacement", apiKey: "new-test-secret" }, cookie);
      assert.equal(response.status, 200);
      assert.equal((await db.brand("brand_1")).accountDetails?.whopCompanyId, "biz_Replacement");
      assert.equal((await db.brand("brand_1")).whop.account, "biz_Replacement");
      assert.equal((await response.text()).includes("new-test-secret"), false);
      const shopifyDomain = "original-shop.myshopify.com";
      globalThis.fetch = async () => new Response(JSON.stringify({ data: { shop: { name: "Example", myshopifyDomain: shopifyDomain, currencyCode: "USD" }, currentAppInstallation: { accessScopes: [{ handle: "read_products" }, { handle: "read_inventory" }] } } }), { status: 200 });
      response = await call("/api/brands/brand_1/connections", "POST", { provider: "shopify", domain: shopifyDomain, accessToken: "test-shopify-secret" }, cookie);
      assert.equal(response.status, 200);
      assert.equal((await db.brand("brand_1")).accountDetails?.shopifyDomain, shopifyDomain);
      assert.equal((await db.brand("brand_1")).accountDetails?.whopCompanyId, "biz_Replacement");
      assert.equal((await db.brand("brand_1")).status, "draft");
      assert.equal((await db.brand("brand_1")).products.length, 0);
      await assert.rejects(async () => await db.updateBrand("brand_1", { accountDetails: { ...accountDetails(await db.brand("brand_1")), shopifyDomain: "replacement.myshopify.com" } }), /Verify the replacement shopify/);
    } finally { globalThis.fetch = originalFetch; }
  });
});
