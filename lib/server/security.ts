import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, verify as verifySignature } from "node:crypto";

import { HttpError } from "./errors";
import { requestSite, requireSitePath } from "./hosts";
export { HttpError } from "./errors";

const COOKIE = "limitless_session";
const SESSION_SECONDS = 60 * 60 * 8;
const ADMIN_SESSION_URL = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-admin-auth-v2";
const ADMIN_SESSION_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErX+FTG3Peu9nD2KcTwIMt7DwUVFN
GVDKOnMN9AUWkUsTqwO+LY66AerM5bkAZ+fdsN053yl+1gZnEFqcETSs9g==
-----END PUBLIC KEY-----`;

type AdminSessionPayload = {
  v: number;
  aud: string;
  iat: number;
  exp: number;
  nonce: string;
};

export function authConfigured() {
  return ADMIN_SESSION_URL.startsWith("https://") && ADMIN_SESSION_PUBLIC_KEY.includes("BEGIN PUBLIC KEY");
}
export function demoMode() {
  return process.env.NODE_ENV !== "production" && process.env.DATABASE_URL === undefined && process.env.LIMITLESS_DATABASE_URL === undefined && !process.env.NETLIFY && !process.env.CREDENTIAL_ENCRYPTION_KEY && !process.env.LIMITLESS_CREDENTIAL_KEY;
}
function configuredEncryptionKey() { return process.env.LIMITLESS_CREDENTIAL_KEY || process.env.CREDENTIAL_ENCRYPTION_KEY || ""; }
export function encryptionConfigured() { return /^[a-fA-F0-9]{64}$/.test(configuredEncryptionKey()); }

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validAdminToken(value: string, now = Date.now()) {
  if (!value || value.length > 2048) return false;
  const [encoded, signature, ...extra] = value.split(".");
  if (extra.length || !encoded || !signature) return false;
  let payload: AdminSessionPayload;
  try {
    const verified = verifySignature(
      "sha256",
      Buffer.from(encoded),
      { key: ADMIN_SESSION_PUBLIC_KEY, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    if (!verified) return false;
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AdminSessionPayload;
  } catch {
    return false;
  }
  const seconds = Math.floor(now / 1000);
  return payload.v === 2 && payload.aud === "limitless-admin" && Number.isInteger(payload.iat) && Number.isInteger(payload.exp) && typeof payload.nonce === "string" && payload.nonce.length >= 24 && payload.iat <= seconds + 60 && payload.exp > seconds && payload.exp <= seconds + SESSION_SECONDS + 60;
}

export async function issueAdminSession(password: string) {
  if (password.length < 16 || password.length > 1024) throw new HttpError(401, "Incorrect password.");
  let response: Response;
  try {
    response = await fetch(ADMIN_SESSION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", password }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
  } catch {
    throw new HttpError(503, "Administrator sign-in service is temporarily unavailable.");
  }
  let result: { token?: string; error?: string } = {};
  try { result = await response.json() as { token?: string; error?: string }; }
  catch { /* handled below */ }
  if (response.status === 401) throw new HttpError(401, "Incorrect password.");
  if (response.status === 429) throw new HttpError(429, "Too many sign-in attempts. Please try again later.");
  if (!response.ok || !result.token || !validAdminToken(result.token)) throw new HttpError(503, result.error || "Administrator sign-in service returned an invalid session.");
  return result.token;
}

// Compatibility only: the production login route uses issueAdminSession().
export function verifyPassword(_password: string) { return false; }

export function sessionCookie(tokenOrLogout: string | boolean | null = null) {
  const token = typeof tokenOrLogout === "string" ? tokenOrLogout : null;
  const value = token ?? "";
  const secure = process.env.NODE_ENV === "production" || process.env.APP_URL?.startsWith("https:");
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_SECONDS : 0}${secure ? "; Secure" : ""}`;
}
export function authenticated(request: Request, now = Date.now()) {
  if (!authConfigured()) return false;
  const value = request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
  return validAdminToken(value, now);
}
export function requireAdmin(request: Request) {
  if (demoMode()) return;
  if (!authConfigured()) throw new HttpError(503, "Administrator access is not configured.");
  if (!authenticated(request)) throw new HttpError(401, "Sign in to manage your workspace.");
}
export function requireCredentials(request: Request) {
  requireAdmin(request);
  if (demoMode()) throw new HttpError(403, "Real connections are disabled in the public demo. Configure administrator authentication and credential encryption first.");
  if (!encryptionConfigured()) throw new HttpError(503, "Credential encryption is unavailable in this deployment.");
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
  const session = cookieValue(request, COOKIE);
  const binding = authenticated(request) ? session : "anonymous";
  return Buffer.from(`${publicOrigin}:${binding}:${payload}`).toString("base64url");
}

function validCsrf(request: Request, token: string, publicOrigin: string, now = Date.now()) {
  if (token.length > 512) return false;
  const match = /^(\d{10})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]+)$/.exec(token);
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
  return !!token && token.length <= 512 && cookie.length <= 512 && safeEqual(token, cookie) && validCsrf(request, token, proxy.public);
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
  return Buffer.from(configuredEncryptionKey(), "hex");
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
