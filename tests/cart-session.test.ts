import test from "node:test";
import assert from "node:assert/strict";
import type { Brand } from "../lib/types";
import { createCartSession, publicCartBrand, readCartSession } from "../lib/server/cart-session";

const brand: Brand = {
  id: "brand_cart",
  name: "COZYINFANTS",
  slug: "cozyinfants",
  category: "Kids",
  domain: "cozyinfants.com",
  accent: "#123456",
  logoInitial: "C",
  checkoutTitle: "Checkout",
  announcement: "",
  supportEmail: "",
  shippingPrice: 0,
  freeShippingThreshold: 0,
  status: "draft",
  mode: "demo",
  shopify: { status: "verified", account: "cozy.myshopify.com" },
  whop: { status: "verified", account: "biz_test" },
  products: [
    { id: "gid://shopify/ProductVariant/48885625847982", variantId: "gid://shopify/ProductVariant/48885625847982", title: "Cuddle Bears · Peachy", description: "", price: 49, available: true },
    { id: "gid://shopify/ProductVariant/48885625880750", variantId: "gid://shopify/ProductVariant/48885625880750", title: "Cuddle Bears · Raffy", description: "", price: 49, available: true },
  ],
  accountDetails: { shopifyDomain: "cozy.myshopify.com", shopifyAliases: [], whopCompanyId: "biz_test", storefrontAliases: [], customerAccountDomain: "" },
  createdAt: "2026-09-13T00:00:00.000Z",
};

async function encrypted(fn: () => void | Promise<void>) {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = "ab".repeat(32);
  try { await fn(); }
  finally { if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY; else process.env.CREDENTIAL_ENCRYPTION_KEY = previous; }
}

test("storefront cart accepts numeric Shopify variant IDs and normalizes them to imported product IDs", async () => encrypted(() => {
  const now = Date.UTC(2026, 8, 13, 20, 0, 0);
  const created = createCartSession(brand, { items: [{ variantId: "48885625847982", quantity: 2 }, { variantId: "gid://shopify/ProductVariant/48885625880750", quantity: 1 }] }, now);
  assert.deepEqual(created.items, [
    { productId: "gid://shopify/ProductVariant/48885625847982", quantity: 2 },
    { productId: "gid://shopify/ProductVariant/48885625880750", quantity: 1 },
  ]);
  const decoded = readCartSession(brand, created.token, now + 60_000);
  assert.deepEqual(decoded.items, created.items);
  assert.equal(decoded.brandId, brand.id);
  assert.equal(decoded.slug, brand.slug);
}));

test("storefront cart rejects duplicate aliases, unavailable products, tampering, cross-brand use, and expiry", async () => encrypted(() => {
  const now = Date.UTC(2026, 8, 13, 20, 0, 0);
  assert.throws(() => createCartSession(brand, { items: [
    { variantId: "48885625847982", quantity: 1 },
    { variantId: "gid://shopify/ProductVariant/48885625847982", quantity: 1 },
  ] }, now), /same Shopify variant/i);

  const unavailable = { ...brand, products: brand.products.map((product, index) => index === 0 ? { ...product, available: false } : product) };
  assert.throws(() => createCartSession(unavailable, { items: [{ variantId: "48885625847982", quantity: 1 }] }, now), /no longer available/i);

  const created = createCartSession(brand, { items: [{ variantId: "48885625847982", quantity: 1 }] }, now);
  const tampered = `${created.token.slice(0, -1)}${created.token.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => readCartSession(brand, tampered, now + 1_000), /invalid/i);
  assert.throws(() => readCartSession({ ...brand, id: "brand_other" }, created.token, now + 1_000), /invalid|belong/i);
  assert.throws(() => readCartSession(brand, created.token, now + 31 * 60_000), /expired/i);
}));

test("public cart brand strips provider account identifiers and Shopify variant aliases", () => {
  const safe = publicCartBrand(brand);
  assert.equal(safe.accountDetails, undefined);
  assert.deepEqual(safe.shopify, { status: "verified" });
  assert.deepEqual(safe.whop, { status: "verified" });
  assert.equal("variantId" in safe.products[0], false);
  assert.equal(safe.products[0].id, brand.products[0].id);
});
