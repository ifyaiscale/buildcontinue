import { z } from "zod";
import type { Brand } from "../types";
import { decrypt, encrypt, HttpError } from "./security";

const CART_TTL_MS = 30 * 60 * 1000;
const MAX_TOKEN_LENGTH = 16_000;

export const storefrontCartInput = z.object({
  items: z.array(z.object({
    variantId: z.string().trim().min(1).max(200),
    quantity: z.number().int().min(1).max(20),
  }).strict()).min(1).max(30),
}).strict();

const cartPayload = z.object({
  version: z.literal(1),
  brandId: z.string().min(1).max(200),
  slug: z.string().min(1).max(200),
  items: z.array(z.object({ productId: z.string().min(1).max(200), quantity: z.number().int().min(1).max(20) }).strict()).min(1).max(30),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
}).strict();

export type CartSession = z.infer<typeof cartPayload>;

function variantKey(value: string) {
  const trimmed = value.trim();
  const gid = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/.exec(trimmed);
  if (gid) return `shopify:${gid[1]}`;
  if (/^\d+$/.test(trimmed)) return `shopify:${trimmed}`;
  return `id:${trimmed}`;
}

function resolveProductId(brand: Brand, requestedVariantId: string) {
  const requested = variantKey(requestedVariantId);
  const matches = brand.products.filter((product) => {
    const identifiers = [product.id, product.variantId].filter((value): value is string => Boolean(value));
    return identifiers.some(identifier => variantKey(identifier) === requested);
  });
  if (matches.length !== 1) throw new HttpError(409, "A cart item no longer matches this store catalog. Return to the store and try checkout again.");
  if (!matches[0].available) throw new HttpError(409, "A cart item is no longer available. Return to the store and update your cart.");
  return matches[0].id;
}

export function createCartSession(brand: Brand, input: unknown, now = Date.now()) {
  const parsed = storefrontCartInput.parse(input);
  const seen = new Set<string>();
  const items = parsed.items.map((item) => {
    const productId = resolveProductId(brand, item.variantId);
    if (seen.has(productId)) throw new HttpError(422, "The same Shopify variant cannot appear twice in one cart handoff.");
    seen.add(productId);
    return { productId, quantity: item.quantity };
  });
  const payload: CartSession = { version: 1, brandId: brand.id, slug: brand.slug, items, issuedAt: now, expiresAt: now + CART_TTL_MS };
  return { token: encrypt(JSON.stringify(payload), `storefront-cart:${brand.id}:v1`), items, expiresAt: payload.expiresAt };
}

export function readCartSession(brand: Brand, token: string, now = Date.now()): CartSession {
  if (!token || token.length > MAX_TOKEN_LENGTH) throw new HttpError(422, "This cart link is invalid. Return to the store and try checkout again.");
  let decoded: unknown;
  try { decoded = JSON.parse(decrypt(token, `storefront-cart:${brand.id}:v1`)); }
  catch { throw new HttpError(422, "This cart link is invalid. Return to the store and try checkout again."); }
  const parsed = cartPayload.safeParse(decoded);
  if (!parsed.success || parsed.data.brandId !== brand.id || parsed.data.slug !== brand.slug) throw new HttpError(422, "This cart link does not belong to this store.");
  if (parsed.data.expiresAt <= now || parsed.data.issuedAt > now + 60_000 || parsed.data.expiresAt - parsed.data.issuedAt > CART_TTL_MS) throw new HttpError(410, "This cart link has expired. Return to the store and start checkout again.");
  for (const item of parsed.data.items) {
    const product = brand.products.find(candidate => candidate.id === item.productId);
    if (!product || !product.available) throw new HttpError(409, "A cart item changed or became unavailable. Return to the store and update your cart.");
  }
  return parsed.data;
}

export function publicCartBrand(brand: Brand): Brand {
  const { accountDetails: _accountDetails, ...publicFields } = brand;
  return { ...publicFields, shopify: { status: brand.shopify.status }, whop: { status: brand.whop.status }, products: brand.products.map(({ variantId: _variantId, ...product }) => product) };
}
