import test from "node:test";
import assert from "node:assert/strict";
import { checkOrigin, csrfChallenge, sessionCookie } from "../lib/server/security";
import { handleApi } from "../lib/server/api";
import { route } from "../lib/server/http";
import { Store } from "../lib/server/store";

const publicOrigin = "https://private-preview.example";
const internal = "http://localhost:3000";
const cookiePair = (value: string) => value.split(";", 1)[0];
const get = (cookie = "") => new Request(`${internal}/api/auth/csrf`, { headers: { host: "localhost:3000", cookie, "sec-fetch-site": "same-origin" } });
function post(token = "", cookie = "", path = "/api/auth/login", extra: Record<string, string> = {}, payload: unknown = { password: "synthetic-test-password" }) {
  return new Request(`${internal}${path}`, { method: "POST", headers: { host: "localhost:3000", origin: internal, "content-type": "application/json", "sec-fetch-site": "same-origin", "x-limitless-origin": publicOrigin, "x-limitless-csrf": token, cookie, ...extra }, body: JSON.stringify(payload) });
}
async function configured(fn: () => void | Promise<void>) {
  const values = { NODE_ENV: "development", APP_URL: publicOrigin, DEV_PROXY_ORIGIN: internal, ADMIN_PASSWORD: "synthetic-test-password", ADMIN_PASSWORD_HASH: undefined, SESSION_SECRET: "s".repeat(48), CREDENTIAL_ENCRYPTION_KEY: "ab".repeat(32), CHECKOUT_ORIGINS: JSON.stringify({ "https://checkout.example": "aure-studio" }) };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { await fn(); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("signed proxy proof permits login, rotates across sessions, and protects authenticated mutations", async () => configured(async () => {
  const handler = route(handleApi);
  const response = await handler(get());
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const { token } = await response.json();
  const csrfCookie = response.headers.get("set-cookie")!;
  for (const flag of ["__Host-limitless_csrf=", "Path=/", "Secure", "HttpOnly", "SameSite=Strict"]) assert.ok(csrfCookie.includes(flag));
  assert.equal(csrfCookie.includes("Domain="), false);
  const login = await handler(post(token, cookiePair(csrfCookie)));
  assert.equal(login.status, 200);
  const session = cookiePair(login.headers.get("set-cookie")!);
  const cookies = `${session}; ${cookiePair(csrfCookie)}`;
  assert.equal((await handler(post(token, cookies, "/api/auth/logout", {}, {}))).status, 403);
  const fresh = await handler(get(cookies));
  const nextToken = (await fresh.json()).token;
  assert.notEqual(nextToken, token);
  const freshCookies = `${session}; ${cookiePair(fresh.headers.get("set-cookie")!)}`;
  assert.doesNotThrow(() => checkOrigin(post(nextToken, freshCookies, "/api/brands", {}, { name: "Test" })));
  assert.throws(() => checkOrigin(post(nextToken, `${cookiePair(sessionCookie())}; ${cookiePair(fresh.headers.get("set-cookie")!)}`, "/api/brands")), /origin must match/);
  const logout = await handler(post(nextToken, freshCookies, "/api/auth/logout", {}, {}));
  assert.equal(logout.status, 200);
  assert.throws(() => checkOrigin(post(nextToken, cookiePair(fresh.headers.get("set-cookie")!), "/api/brands")), /origin must match/);
}));

test("missing, forged, mismatched, duplicate, stale and oversized CSRF proofs fail closed", async () => configured(() => {
  const first = csrfChallenge(get()); const second = csrfChallenge(get());
  const expired = csrfChallenge(get(), Date.now() - 16 * 60 * 1000);
  const future = csrfChallenge(get(), Date.now() + 16 * 60 * 1000);
  const tampered = `${first.token!.slice(0, -1)}${first.token!.endsWith("a") ? "b" : "a"}`;
  for (const [token, cookie] of [
    ["", ""], ["", cookiePair(first.cookie!)],
    [second.token!, cookiePair(first.cookie!)], [expired.token!, cookiePair(expired.cookie!)], [future.token!, cookiePair(future.cookie!)],
    [tampered, `__Host-limitless_csrf=${tampered}`], ["x".repeat(500), `__Host-limitless_csrf=${"x".repeat(500)}`],
  ]) assert.throws(() => checkOrigin(post(token, cookie)), /origin must match/);
  assert.equal(csrfChallenge(get(cookiePair(first.cookie!))).token, first.token);
}));

test("a valid proof without an unambiguous browser cookie is rejected with actionable guidance", async () => configured(async () => {
  const proof = csrfChallenge(get()); const cookie = cookiePair(proof.cookie!);
  const handler = route(handleApi);
  for (const cookies of ["", `${cookie}; ${cookie}`]) {
    const response = await handler(post(proof.token!, cookies));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "The sign-in security cookie is missing or invalid. Open the workspace in its own tab; do not change your password.");
  }
}));

test("proxy fallback requires exact routing tuple, canonical client origin, JSON and non-cross-site requests", async () => configured(() => {
  const proof = csrfChallenge(get()); const cookie = cookiePair(proof.cookie!);
  const badHeaders: Record<string, string>[] = [
    { origin: "" }, { origin: "null" }, { origin: "https://evil.example" },
    { origin: "http://127.0.0.1:3000" }, { host: "127.0.0.1:3000" },
    { "x-limitless-origin": "" }, { "x-limitless-origin": "https://other-preview.example" },
    { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" },
  ];
  for (const extra of badHeaders) assert.throws(() => checkOrigin(post(proof.token!, cookie, "/api/auth/login", extra)));
  assert.throws(() => checkOrigin(post(proof.token!, cookie, "/api/brands")), /origin must match/);
  assert.throws(() => checkOrigin(post(proof.token!, cookie, "/api/checkout/aure-studio")), /origin must match/);
  const session = cookiePair(sessionCookie()); const bound = csrfChallenge(get(session));
  assert.throws(() => checkOrigin(post(bound.token!, `${session}; ${cookiePair(bound.cookie!)}`, "/api/checkout/aure-studio")), /origin must match/);
  assert.throws(() => checkOrigin(post(bound.token!, `${session}; ${cookiePair(bound.cookie!)}`, "/api/auth/future-route")), /origin must match/);
}));

test("proxy proof is bound to the configured public origin and signing secret", async () => configured(() => {
  const proof = csrfChallenge(get()); const cookie = cookiePair(proof.cookie!);
  process.env.APP_URL = "https://replacement-preview.example";
  assert.throws(() => checkOrigin(post(proof.token!, cookie, "/api/auth/login", { "x-limitless-origin": "https://replacement-preview.example" })), /origin must match/);
  process.env.APP_URL = publicOrigin; process.env.SESSION_SECRET = "t".repeat(48);
  assert.throws(() => checkOrigin(post(proof.token!, cookie)), /origin must match/);
}));

test("opt-in is off by default, fails closed if malformed, and can never relax production isolation", async () => configured(() => {
  const proof = csrfChallenge(get()); const cookie = cookiePair(proof.cookie!);
  delete process.env.DEV_PROXY_ORIGIN;
  assert.deepEqual(csrfChallenge(get()), { token: null, cookie: null });
  assert.throws(() => checkOrigin(post(proof.token!, cookie)), /origin must match/);
  for (const value of ["http://localhost:3001", "http://localhost:3000/", "https://evil.example", "*"]) {
    process.env.DEV_PROXY_ORIGIN = value;
    assert.throws(() => csrfChallenge(get()), /Development proxy access requires/);
  }
  process.env.DEV_PROXY_ORIGIN = internal;
  for (const value of ["", "http://private-preview.example", `${publicOrigin}/`]) {
    process.env.APP_URL = value; assert.throws(() => csrfChallenge(get()));
  }
  process.env.APP_URL = publicOrigin; process.env.SESSION_SECRET = "short";
  assert.throws(() => csrfChallenge(get()));
  process.env.SESSION_SECRET = "s".repeat(48);
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.deepEqual(csrfChallenge(get()), { token: null, cookie: null });
  assert.throws(() => checkOrigin(post(proof.token!, cookie)), /Site not configured/);
  assert.doesNotThrow(() => checkOrigin(new Request(`${publicOrigin}/api/auth/login`, { method: "POST", headers: { origin: publicOrigin, "content-type": "application/json" } })));
}));

test("CSRF endpoint stays unavailable to checkout hosts and cross-site challenges", async () => configured(async () => {
  const handler = route(handleApi);
  const request = new Request("https://checkout.example/api/auth/csrf");
  assert.equal((await handler(request)).status, 404);
  const crossSite = get(); crossSite.headers.set("sec-fetch-site", "cross-site");
  assert.equal((await handler(crossSite)).status, 403);
  for (const host of ["evil.example", "127.0.0.1:3000", "localhost:3001", ""]) {
    const wrongHost = get(); wrongHost.headers.set("host", host);
    assert.equal((await handler(wrongHost)).status, 403);
  }
}));

test("authenticated dashboard requests work through proxy proof without enabling live checkout", async () => configured(async () => {
  const globals = globalThis as typeof globalThis & { limitlessStore?: Store };
  const previous = globals.limitlessStore; const db = new Store(":memory:"); globals.limitlessStore = db;
  try {
    const session = cookiePair(sessionCookie()); const proof = csrfChallenge(get(session));
    const cookies = `${session}; ${cookiePair(proof.cookie!)}`;
    const handler = route(handleApi);
    const created = await handler(post(proof.token!, cookies, "/api/brands", {}, { name: "Synthetic proxy brand", category: "Test" }));
    assert.equal(created.status, 201);
    assert.equal((await created.json()).mode, "demo");
    assert.equal((await handler(post(proof.token!, cookies, "/api/brands/brand_1/publish", {}, { mode: "live" }))).status, 409);
  } finally { globals.limitlessStore = previous; db.db.close(); }
}));
