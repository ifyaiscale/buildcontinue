import test from "node:test";
import assert from "node:assert/strict";
import { shopifyGraphql, sameShopifyCredentials } from "../lib/server/providers";
import { connectionInput } from "../lib/server/validation";
import { Store } from "../lib/server/store";
import { handleApi } from "../lib/server/api";
import { route } from "../lib/server/http";
import { sessionCookie } from "../lib/server/security";

const app = { domain: "test.myshopify.com", authMethod: "client_credentials" as const, clientId: "test-client", clientSecret: "test-secret" };
test("tokens are shared across concurrent requests, renewed before expiry, and isolated by credentials", async () => {
  const originalFetch = globalThis.fetch; const originalNow = Date.now;
  let time = originalNow(); let grants = 0;
  const seen: string[] = [];
  Date.now = () => time;
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.redirect, "error");
    if (String(url).endsWith("/admin/oauth/access_token")) {
      grants++;
      const payload = new URLSearchParams(String(init?.body));
      assert.equal(payload.get("grant_type"), "client_credentials");
      assert.equal(payload.get("client_id"), app.clientId);
      return Response.json({ access_token: `token-${grants}`, expires_in: 86400 });
    }
    seen.push(new Headers(init?.headers).get("X-Shopify-Access-Token")!);
    return Response.json({ data: { ok: true } });
  };
  try {
    await Promise.all(Array.from({ length: 10 }, () => shopifyGraphql(app, "{ shop { name } }")));
    assert.equal(grants, 1); assert.ok(seen.every(value => value === "token-1"));
    time += 86400 * 1000 - 59000;
    await shopifyGraphql(app, "{}"); assert.equal(grants, 2);
    await shopifyGraphql({ ...app, clientSecret: "rotated-secret" }, "{}"); assert.equal(grants, 3);
    await shopifyGraphql({ ...app, domain: "other.myshopify.com" }, "{}"); assert.equal(grants, 4);
    await assert.rejects(shopifyGraphql({ ...app, domain: "example.com" }, "{}"), /permanent/);
    assert.equal(grants, 4);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

test("failed or malformed grants do not cache credentials or expose provider errors", async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  const credentials = { ...app, clientId: "failed-client" };
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ error: app.clientSecret }, { status: 401 }); };
    await assert.rejects(shopifyGraphql(credentials, "{}"), error => error instanceof Error && !error.message.includes(app.clientSecret) && /installed/.test(error.message));
    globalThis.fetch = async () => { calls++; return Response.json({ access_token: "bad", expires_in: -1 }); };
    await assert.rejects(shopifyGraphql(credentials, "{}"), /expiry/);
    assert.equal(calls, 2);
    assert.equal(connectionInput.safeParse({ provider: "shopify", ...app, accessToken: "ambiguous" }).success, false);
    assert.equal(sameShopifyCredentials(app, { ...app }), true);
    assert.equal(sameShopifyCredentials(app, { domain: app.domain, accessToken: "old" }), false);
    assert.equal(sameShopifyCredentials(app, { ...app, clientSecret: "new" }), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("authenticated app connection persists encrypted credentials and preserves the previous connection on failed verification", async () => {
  const keys = ["NODE_ENV", "APP_URL", "ADMIN_PASSWORD", "SESSION_SECRET", "CREDENTIAL_ENCRYPTION_KEY"];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const globals = globalThis as typeof globalThis & { limitlessStore?: Store };
  const previous = globals.limitlessStore; const originalFetch = globalThis.fetch;
  const db = new Store(":memory:"); globals.limitlessStore = db;
  Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://admin.example", ADMIN_PASSWORD: "synthetic-password-long", SESSION_SECRET: "s".repeat(40), CREDENTIAL_ENCRYPTION_KEY: "ab".repeat(32) });
  const handler = route(handleApi);
  const send = (path: string, body?: unknown) => handler(new Request(`https://admin.example${path}`, { method: body ? "POST" : "GET", headers: { Cookie: sessionCookie().split(";")[0], Origin: "https://admin.example", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  try {
    globalThis.fetch = async url => String(url).endsWith("access_token")
      ? Response.json({ access_token: "synthetic-access-token", expires_in: 86400 })
      : Response.json({ data: { shop: { name: "Test", myshopifyDomain: app.domain, currencyCode: "USD" }, currentAppInstallation: { accessScopes: [{ handle: "read_products" }, { handle: "read_inventory" }] } } });
    const payload = { provider: "shopify", ...app, clientId: "integration-client" };
    const response = await send("/api/brands/brand_1/connections", payload);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).shopify.status, "verified");
    const encrypted = db.db.prepare("SELECT data FROM credentials").get()!.data as string;
    assert.ok(!encrypted.includes(app.clientSecret));
    assert.deepEqual(await db.credential("brand_1", "shopify"), payload);
    const state = await (await send("/api/state")).text();
    assert.ok(!state.includes(app.clientSecret)); assert.ok(!state.includes("synthetic-access-token"));
    globalThis.fetch = async () => Response.json({}, { status: 403 });
    const failed = await send("/api/brands/brand_1/connections", { ...payload, clientSecret: "bad-replacement" });
    assert.equal(failed.status, 422);
    assert.deepEqual(await db.credential("brand_1", "shopify"), payload);
  } finally {
    globals.limitlessStore = previous; globalThis.fetch = originalFetch; await db.close();
    for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
