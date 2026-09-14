import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { z } from "zod";
import type { Brand } from "../types";
import { HttpError } from "./errors";

const MAX_RECEIPT_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const UPLOAD_TTL_MS = 10 * 60 * 1000;
const ASSET_ACCESS_TTL_MS = 5 * 60 * 1000;
export const PERSONALIZATION_REF_PATTERN = /^pers_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPart = /^[A-Za-z0-9_-]+$/;

const uploadCapability = z.object({
  typ: z.literal("facejamas-upload"),
  brandId: z.string().min(1).max(200),
  slug: z.literal("facejamas"),
  origin: z.string().url().max(500),
  ref: z.string().regex(PERSONALIZATION_REF_PATTERN),
  jti: z.string().uuid(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).strict();

const uploadReceipt = z.object({
  typ: z.literal("facejamas-receipt"),
  brandId: z.string().min(1).max(200),
  slug: z.literal("facejamas"),
  ref: z.string().regex(PERSONALIZATION_REF_PATTERN),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().min(1).max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).strict();

const assetCapability = z.object({
  typ: z.literal("facejamas-asset"),
  ref: z.string().regex(PERSONALIZATION_REF_PATTERN),
  jti: z.string().uuid(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).strict();

function b64Json(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parsePayload(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some(part => !part || !tokenPart.test(part))) throw new HttpError(422, "Personalization proof is invalid.");
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { throw new HttpError(422, "Personalization proof is invalid."); }
  return { parts, payload, signed: Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"), signature: Buffer.from(parts[2], "base64url") };
}

function privateKey() {
  const value = process.env.FACEJAMAS_CAPABILITY_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!value) throw new HttpError(503, "FaceJamas personalization signing is not configured.");
  try { return createPrivateKey(value); }
  catch { throw new HttpError(503, "FaceJamas personalization signing is not configured correctly."); }
}

function receiptPublicKey() {
  const value = process.env.FACEJAMAS_RECEIPT_PUBLIC_KEY?.replace(/\\n/g, "\n").trim();
  if (!value) throw new HttpError(503, "FaceJamas personalization verification is not configured.");
  try { return createPublicKey(value); }
  catch { throw new HttpError(503, "FaceJamas personalization verification is not configured correctly."); }
}

function signPayload(payload: unknown) {
  const header = b64Json({ alg: "ES256", typ: "JWT" });
  const body = b64Json(payload);
  const signed = Buffer.from(`${header}.${body}`, "utf8");
  const signature = sign("sha256", signed, { key: privateKey(), dsaEncoding: "ieee-p1363" });
  return `${header}.${body}.${signature.toString("base64url")}`;
}

function verifyReceiptToken(token: string) {
  if (!token || token.length > 3000) throw new HttpError(422, "Personalization proof is invalid.");
  const parsed = parsePayload(token);
  if (!verify("sha256", parsed.signed, { key: receiptPublicKey(), dsaEncoding: "ieee-p1363" }, parsed.signature)) {
    throw new HttpError(422, "Personalization proof is invalid.");
  }
  const receipt = uploadReceipt.safeParse(parsed.payload);
  if (!receipt.success) throw new HttpError(422, "Personalization proof is invalid.");
  return receipt.data;
}

function configuredUrl(name: "FACEJAMAS_UPLOAD_URL" | "FACEJAMAS_ASSET_URL") {
  const raw = process.env[name]?.trim();
  if (!raw) throw new HttpError(503, "FaceJamas private media service is not configured yet.");
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new HttpError(503, "FaceJamas private media service is not configured correctly."); }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new HttpError(503, "FaceJamas private media service must use HTTPS.");
  return url;
}

export function issueFaceJamasUploadCapability(brand: Brand, origin: string, now = Date.now()) {
  if (brand.slug !== "facejamas") throw new HttpError(404, "Personalization is not available for this store.");
  const originUrl = new URL(origin);
  const ref = `pers_${randomUUID()}`;
  const payload = uploadCapability.parse({
    typ: "facejamas-upload",
    brandId: brand.id,
    slug: "facejamas",
    origin: originUrl.origin,
    ref,
    jti: randomUUID(),
    iat: now,
    exp: now + UPLOAD_TTL_MS,
  });
  return {
    uploadUrl: configuredUrl("FACEJAMAS_UPLOAD_URL").toString(),
    capability: signPayload(payload),
    personalizationRef: ref,
    expiresAt: payload.exp,
  };
}

export function verifyFaceJamasPersonalization(brand: Brand, ref: string, proof: string, now = Date.now()) {
  if (brand.slug !== "facejamas") throw new HttpError(422, "Personalization is only supported for FaceJamas.");
  if (!PERSONALIZATION_REF_PATTERN.test(ref)) throw new HttpError(422, "FaceJamas personalization reference is invalid.");
  const receipt = verifyReceiptToken(proof);
  if (receipt.brandId !== brand.id || receipt.slug !== brand.slug || receipt.ref !== ref) throw new HttpError(422, "This personalization upload does not belong to this store or item.");
  if (receipt.iat > now + 60_000 || receipt.exp <= now || receipt.exp - receipt.iat > MAX_RECEIPT_AGE_MS) throw new HttpError(410, "This personalization upload expired. Upload the photo again.");
  return receipt;
}

export function issueFaceJamasAssetAccess(ref: string, now = Date.now()) {
  if (!PERSONALIZATION_REF_PATTERN.test(ref)) throw new HttpError(422, "FaceJamas personalization reference is invalid.");
  const payload = assetCapability.parse({
    typ: "facejamas-asset",
    ref,
    jti: randomUUID(),
    iat: now,
    exp: now + ASSET_ACCESS_TTL_MS,
  });
  const target = configuredUrl("FACEJAMAS_ASSET_URL");
  target.searchParams.set("token", signPayload(payload));
  return { url: target.toString(), expiresAt: payload.exp, personalizationRef: ref };
}
