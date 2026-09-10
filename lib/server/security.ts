import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { HttpError } from "./errors";
import { requestSite, requireSitePath } from "./hosts";
export { HttpError } from "./errors";

const COOKIE = "limitless_session";
const SESSION_SECONDS = 60 * 60 * 8;
const HASH_PATTERN = /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/;

export function authConfigured() {
  const password = process.env.ADMIN_PASSWORD || "";
  const hash = process.env.ADMIN_PASSWORD_HASH || "";
  return (hash ? HASH_PATTERN.test(hash) : password.length >= 16) && (process.env.SESSION_SECRET || "").length >= 32;
}
export function demoMode() {
  return process.env.NODE_ENV !== "production" && !process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_HASH && !process.env.SESSION_SECRET && !process.env.CREDENTIAL_ENCRYPTION_KEY;
}
export function encryptionConfigured() { return /^[a-fA-F0-9]{64}$/.test(process.env.CREDENTIAL_ENCRYPTION_KEY || ""); }

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifyPassword(password: string) {
  if (!authConfigured() || password.length > 1024) return false;
  const hash = process.env.ADMIN_PASSWORD_HASH || "";
  if (hash) {
    if (!HASH_PATTERN.test(hash)) return false;
    const [, salt, expected] = hash.split(":");
    return safeEqual(scryptSync(password, salt, 64).toString("hex"), expected);
  }
  const salt = "limitless-admin-password-compare";
  return timingSafeEqual(scryptSync(password, salt, 64), scryptSync(process.env.ADMIN_PASSWORD || "", salt, 64));
}
function signature(value: string) { return createHmac("sha256", process.env.SESSION_SECRET || "").update(value).digest("base64url"); }
export function sessionCookie(logout = false, now = Date.now()) {
  if (!logout && !authConfigured()) throw new HttpError(503, "Administrator authentication is not configured.");
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
  if (!authConfigured()) throw new HttpError(503, "Administrator access is not configured. Set ADMIN_PASSWORD (16+ characters) or ADMIN_PASSWORD_HASH, and SESSION_SECRET (32+ characters).");
  if (!authenticated(request)) throw new HttpError(401, "Sign in to manage your workspace.");
}
export function requireCredentials(request: Request) {
  requireAdmin(request);
  if (demoMode()) throw new HttpError(403, "Real connections are disabled in the public demo. Configure administrator authentication and credential encryption first.");
  if (!encryptionConfigured()) throw new HttpError(503, "Set a 32-byte CREDENTIAL_ENCRYPTION_KEY before connecting accounts.");
}
export function checkOrigin(request: Request) {
  const site = requestSite(request);
  requireSitePath(site, new URL(request.url).pathname);
  const expected = site.origin;
  const origin = request.headers.get("origin");
  if (!origin || origin !== expected || request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Request origin must match the application origin.");
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
