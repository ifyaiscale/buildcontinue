import test from "node:test";
import assert from "node:assert/strict";
import { requestSite, requireSitePath } from "../lib/server/hosts";
import { checkOrigin, sessionCookie } from "../lib/server/security";
import { Store } from "../lib/server/store";
import { handleApi } from "../lib/server/api";
import { route } from "../lib/server/http";

const admin = "https://admin.example";
const first = "https://checkout.first.example";
const second = "https://checkout.second.example";
const mappings = JSON.stringify({ [first]: "aure-studio", [second]: "form-and-field" });
const request = (origin = first, path = "/api/checkout/aure-studio", options: RequestInit = {}) => new Request(origin + path, options);
const mutation = (origin: string, from: string, path = "/api/checkout/aure-studio", extra: Record<string, string> = {}) => request(origin, path, { method: "POST", headers: { origin: from, "content-type": "application/json", ...extra }, body: "{}" });

async function configured(run: () => void | Promise<void>) {
  const keys = ["NODE_ENV", "APP_URL", "CHECKOUT_ORIGINS", "ADMIN_PASSWORD", "ADMIN_PASSWORD_HASH", "SESSION_SECRET", "CREDENTIAL_ENCRYPTION_KEY"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => delete process.env[key]);
  Object.assign(process.env, { NODE_ENV: "production", APP_URL: admin, CHECKOUT_ORIGINS: mappings, ADMIN_PASSWORD: "synthetic-test-password", SESSION_SECRET: "s".repeat(48) });
  try { await run(); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("registered checkout hosts map to one brand and admin remains a separate host", async () => {
  await configured(() => {
    assert.deepEqual(requestSite(request()), { kind: "checkout", origin: first, slug: "aure-studio" });
    assert.deepEqual(requestSite(request(second)), { kind: "checkout", origin: second, slug: "form-and-field" });
    assert.deepEqual(requestSite(request(admin)), { kind: "admin", origin: admin });
    const normalized = new Request("http://0.0.0.0:3000/", { headers: { host: "checkout.first.example" } });
    assert.equal(requestSite(normalized).kind, "checkout");
    assert.throws(() => requestSite(request("https://unknown.example")), /Site not configured/);
    assert.throws(() => requestSite(request("https://unknown.example", "/", { headers: { "x-forwarded-host": "admin.example", forwarded: "host=admin.example;proto=https" } })), /Site not configured/);
    assert.equal(sessionCookie().includes("Domain="), false);
  });
});

test("checkout origin checks reject other brands, admin origins, absent origin and cross-site submissions", async () => {
  await configured(() => {
    assert.doesNotThrow(() => checkOrigin(mutation(first, first)));
    assert.doesNotThrow(() => checkOrigin(mutation(admin, admin, "/api/brands")));
    for (const from of [second, admin, "https://evil.example", "null", ""]) assert.throws(() => checkOrigin(mutation(first, from)), /origin must match/);
    assert.throws(() => checkOrigin(mutation(first, first, "/api/checkout/aure-studio", { "sec-fetch-site": "cross-site" })), /origin must match/);
    assert.throws(() => checkOrigin(mutation(first, first, "/api/checkout/aure-studio", { "content-type": "text/plain" })), /application\/json/);
    assert.throws(() => checkOrigin(mutation(first, first, "/api/brands")), /not available/);
    assert.throws(() => checkOrigin(mutation(first, first, "/api/checkout/form-and-field")), /not available/);
  });
});

test("invalid host configuration fails closed instead of falling back to dashboard access", async () => {
  await configured(() => {
    for (const value of ["broken", "null", "[]", JSON.stringify({ [admin]: "aure-studio" }), JSON.stringify({ "http://checkout.first.example": "aure-studio" }), JSON.stringify({ [first + "/path"]: "aure-studio" }), JSON.stringify({ [first]: "../other" }), JSON.stringify({ [first]: 1 })]) {
      process.env.CHECKOUT_ORIGINS = value;
      assert.throws(() => requestSite(request(admin)), error => (error as { status: number }).status === 503);
    }
    process.env.CHECKOUT_ORIGINS = mappings;
    delete process.env.APP_URL;
    assert.throws(() => requestSite(request()), /Configure APP_URL/);
  });
});

test("checkout domains allow only their own checkout pages and API", async () => {
  await configured(() => {
    const site = requestSite(request());
    for (const path of ["/", "/checkout/aure-studio", "/api/checkout/aure-studio/"]) assert.doesNotThrow(() => requireSitePath(site, path));
    for (const path of ["/api/state", "/api/auth/status", "/api/auth/login", "/api/brands", "/checkout/form-and-field", "/api/checkout/form-and-field", "/api/checkout/aure-studio-extra"]) assert.throws(() => requireSitePath(site, path), /not available/);
  });
});

test("mapped checkout APIs cannot read drafts or admin data even with a valid admin cookie", async () => {
  await configured(async () => {
    const globals = globalThis as typeof globalThis & { limitlessStore?: Store };
    const previousStore = globals.limitlessStore;
    const db = new Store(":memory:");
    globals.limitlessStore = db;
    const handler = route(handleApi);
    const cookie = sessionCookie();
    try {
      assert.equal((await handler(request(first, "/api/checkout/aure-studio", { headers: { cookie } }))).status, 404);
      assert.equal((await handler(request(admin, "/api/checkout/aure-studio", { headers: { cookie } }))).status, 200);
      for (const path of ["/api/state", "/api/auth/status", "/api/checkout/form-and-field"]) assert.equal((await handler(request(first, path, { headers: { cookie } }))).status, 404);
      db.publish("brand_1", "demo");
      assert.equal((await handler(request())).status, 200);
      const payload = { mode: "demo", items: [{ productId: "product_1", quantity: 1 }], customer: { email: "test@example.com", firstName: "Test", lastName: "Buyer", address: "1 Example Street", city: "Portland", postalCode: "97201", country: "US" } };
      const response = await handler(request(first, "/api/checkout/aure-studio", { method: "POST", headers: { origin: first, "content-type": "application/json" }, body: JSON.stringify(payload) }));
      assert.equal(response.status, 201);
      assert.equal((await response.json()).total, 53);
      assert.equal((await handler(request("https://unknown.example", "/api/state", { headers: { cookie } }))).status, 404);
      assert.equal((await handler(request(admin, "/api/state", { headers: { cookie } }))).status, 200);
    } finally { globals.limitlessStore = previousStore; db.db.close(); }
  });
});

test("local development keeps path-based previews while explicit checkout mappings remain isolated", async () => {
  await configured(() => {
    Object.assign(process.env, { NODE_ENV: "development" });
    delete process.env.APP_URL;
    delete process.env.CHECKOUT_ORIGINS;
    assert.deepEqual(requestSite(request("http://localhost:3000", "/")), { kind: "admin", origin: "http://localhost:3000" });
    process.env.CHECKOUT_ORIGINS = JSON.stringify({ "http://localhost:3100": "aure-studio" });
    assert.equal(requestSite(request("http://localhost:3100", "/")).kind, "checkout");
    assert.throws(() => requireSitePath(requestSite(request("http://localhost:3100", "/")), "/api/state"), /not available/);
  });
});
