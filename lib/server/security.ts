import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { HttpError } from "./errors";
import { requestSite, requireSitePath } from "./hosts";
export { HttpError } from "./errors";

const COOKIE = "limitless_session";
const SESSION_SECONDS = 60 * 60 * 8;
const HASH_PATTERN = /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/;
const BOOTSTRAP_ADMIN_HASH = "scrypt:b687252070872fe26b56dfa25397275a:069e3a43f1f8af6901990de40a69f87eaa76abdc667305c3871c963e006b0830a859dce8f1f9bcc5e6d1aa67cfc48f2098f3a9101db29a0fc29d9fd2036b734c";

function adminPassword() {
  return process.env.LIMITLESS_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "";
}
function adminPasswordHash() {
  return process.env.LC_AUTH_A || process.env.LIMITLESS_ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH || BOOTSTRAP_ADMIN_HASH;
}
function sessionSecret() {
  const configured = process.env.LC_AUTH_B || process.env.LIMITLESS_SESSION_SECRET || process.env.SESSION_SECRET || "";
  if (configured.length >= 32) return configured;
  const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(encryptionKey)) return "";
  return createHmac("sha256", encryptionKey)
    .update("limitless-admin-session-v1")
    .digest("hex");
}

export function authConfigured() {
  const password = adminPassword();
  const hash = adminPasswordHash();
  return (hash ? HASH_PATTERN.test(hash) : password.length >= 16) && sessionSecret().length >= 32;
}
export function demoMode() {
  return process.env.NODE_ENV !== "production" && process.env.DATABASE_URL === undefined && !process.env.NETLIFY && !adminPassword() && !process.env.LC_AUTH_A && !process.env.LIMITLESS_ADMIN_PASSWORD_HASH && !process.env.ADMIN_PASSWORD_HASH && !process.env.LC_AUTH_B && !process.env.LIMITLESS_SESSION_SECRET && !process.env.SESSION_SECRET && !process.env.CREDENTIAL_ENCRYPTION_KEY;
}
export function encryptionConfigured() { return /^[a-fA-F0-9]{64}$/.test(process.env.CREDENTIAL_ENCRYPTION_KEY || ""); }

function authDiagnosticCode() {
  const hash = adminPasswordHash();
  return `H${HASH_PATTERN.test(hash) ? 1 : 0}-S${sessionSecret().length >= 32 ? 1 : 0}-E${encryptionConfigured() ? 1 : 0}`;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifyPassword(password: string) {
  if (!authConfigured() || password.length > 1024) return false;
  const hash = adminPasswordHash();
  if (hash) {
    if (!HASH_PATTERN.test(hash)) return false;
    const [, salt, expected] = hash.split(":");
    return safeEqual(scryptSync(password, salt, 64).toString("hex"), expected);
  }
  const salt = "limitless-admin-password-compare";
  return timingSafeEqual(scryptSync(password, salt, 64), scryptSync(adminPassword(), salt, 64));
}
function signature(value: string) { return createHmac("sha256", sessionSecret()).update(value).digest("base64url"); }
export function sessionCookie(logout = false, now = Date.now()) {
  if (!logout && !authConfigured()) throw new HttpError(503, `Administrator authentication is not configured (${authDiagnosticCode()}).`);
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(24).toString("base64url")}`;
  const value = logout ? "" : `${payload}.${signature(payload)}`;
  const secure = process.env.NODE_ENV === "production" || process.env.APP_URL?.startsWith("https:");
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${logout ? 0 : SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}
export function authenticated(request: Request, now = Date.now()) {
  if (!authConfigured()) return false;
  const value = request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!value || value.length > 256) return false;
  const [expires, nonce, mac, ...extra] = value.split(".");
  if (extra.length || !expires || !nonce || !mac || !/^\d+$/.test(expires)) return false;
  const expiry = Number(expires);
  return expiry > Math.floor(now / 1000) && expiry <= Math.floor(now / 1000) + SESSION_SECONDS && safeEqual(mac, signature(`${expires}.${nonce}`));
}
export function requireAdmin(request: Request) {
  if (demoMode()) return;
  if (!authConfigured()) throw new HttpError(503, `Administrator access is not configured (${authDiagnosticCode()}).`);
  if (!authenticated(request)) throw new HttpError(401, "Sign in to manage your workspace.");
}
export function requireCredentials(request: Request) {
  requireAdmin(request);
  if (demoMode()) throw new HttpError(403, "Real connections are disabled in the public demo. Configure administrator authentication and credential encryption first.");
  if (!encryptionConfigured()) throw new HttpError(503, "Set a 32-byte CREDENTIAL_ENCRYPTION_KEY before connecting accounts.");
}

const CSRF_COOKIE = "__Host-limitless_csrf";
const CSRF_SECONDS = 15 * 60;

function proxyOrigin() {
  if (process.env.NODE_ENV !== "development" || !process.env.DEV_PROXY_ORIGIN) return null;
  const publicOrigin = process.env.APP_URL || "";
  let url: URL;
  try { url = new URL(publicOrigin); }
  catch { throw new HttpError(503, "Configure an exact HTTPS APP_URL before enabling the development proxy."); }
  if (process.env.DEV_PROXY_ORIGIN !== "http://localhost:3000" || url.protocol !== "https:" || url.origin !== publicOrigin || !authConfigured()) {
    throw new HttpError(503, "Development proxy access requires http://localhost:3000, an exact HTTPS APP_URL, and private authentication.");
  }
  return { internal: process.env.DEV_PROXY_ORIGIN, public: publicOrigin };
}

function cookieValue(request: Request, name: string) {
  const values = (request.headers.get("cookie") || "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : "";
}

function csrfSignature(request: Request, payload: string, publicOrigin: string) {
  const binding = signature(`csrf-session:${authenticated(request) ? cookieValue(request, COOKIE) : "anonymous"}`);
  return signature(JSON.stringify(["limitless-csrf-v1", publicOrigin, binding, payload]));
}

function validCsrf(request: Request, token: string, publicOrigin: string, now = Date.now()) {
  if (token.length > 200) return false;
  const match = /^(\d{10})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]); const seconds = Math.floor(now / 1000);
  return expires > seconds && expires <= seconds + CSRF_SECONDS && safeEqual(match[3], csrfSignature(request, `${match[1]}.${match[2]}`, publicOrigin));
}

export function csrfChallenge(request: Request, now = Date.now()) {
  const proxy = proxyOrigin();
  if (!proxy) return { token: null, cookie: null };
  const site = requestSite(request);
  requireSitePath(site, "/api/auth/csrf");
  if (site.kind !== "admin" || site.origin !== proxy.public || request.headers.get("host") !== "localhost:3000" || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Open the private workspace directly to sign in.");
  rateLimit("csrf", 120, 60000);
  let token = cookieValue(request, CSRF_COOKIE);
  if (!validCsrf(request, token, proxy.public, now)) {
    const payload = `${Math.floor(now / 1000) + CSRF_SECONDS}.${randomBytes(32).toString("base64url")}`;
    token = `${payload}.${csrfSignature(request, payload, proxy.public)}`;
  }
  return { token, cookie: `${CSRF_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${CSRF_SECONDS}` };
}

function verifiedProxyMutation(request: Request, site: ReturnType<typeof requestSite>) {
  const proxy = proxyOrigin();
  if (!proxy || site.kind !== "admin" || site.origin !== proxy.public) return false;
  const path = new URL(request.url).pathname;
  if (path !== "/api/auth/login" && !authenticated(request)) return false;
  if (path !== "/api/auth/login" && path !== "/api/auth/logout" && !/^\/api\/brands(?:\/|$)/.test(path)) return false;
  if (request.headers.get("origin") !== proxy.internal || request.headers.get("host") !== "localhost:3000" || request.headers.get("x-limitless-origin") !== proxy.public) return false;
  const token = request.headers.get("x-limitless-csrf") || "";
  const cookie = cookieValue(request, CSRF_COOKIE);
  if (!cookie && token && validCsrf(request, token, proxy.public)) throw new HttpError(403, "The sign-in security cookie is missing or invalid. Open the workspace in its own tab; do not change your password.");
  return !!token && token.length <= 200 && cookie.length <= 200 && safeEqual(token, cookie) && validCsrf(request, token, proxy.public);
}

export function checkOrigin(request: Request) {
  const site = requestSite(request);
  requireSitePath(site, new URL(request.url).pathname);
  const expected = site.origin;
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site" || (origin !== expected && !verifiedProxyMutation(request, site))) throw new HttpError(403, "Request origin must match the application origin.");
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "Use application/json.");
}

const limits = new Map<string, { count: number; expires: number }>();
export function rateLimit(key: string, maximum: number, interval: number, now = Date.now()) {
  const bucket = limits.get(key);
  if (!bucket || bucket.expires <= now) { limits.set(key, { count: 1, expires: now + interval }); return; }
  if (bucket.count >= maximum) throw new HttpError(429, "Too many requests. Please try again later.");
  bucket.count++;
}
function encryptionKey() {
  if (!encryptionConfigured()) throw new HttpError(503, "Credential encryption is not configured.");
  return Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY!, "hex");
}
export function encrypt(value: string, context: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(v => v.toString("base64url")).join(".");
}
export function decrypt(value: string, context: string): string {
  const parts = value.split(".");
  if (parts.length !== 3) throw new HttpError(503, "Saved credential could not be decrypted. Reconnect the account.");
  const [iv, tag, data] = parts.map(v => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
