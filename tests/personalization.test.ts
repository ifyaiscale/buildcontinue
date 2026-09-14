import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Brand } from "../lib/types";
import { Store } from "../lib/server/store";
import { createCartSession, readCartSession } from "../lib/server/cart-session";
import { claimFaceJamasPersonalizations, finalizeFaceJamasPersonalizations, verifyFaceJamasCartPersonalizations } from "../lib/server/personalization";

const ref = "pers_123e4567-e89b-42d3-a456-426614174000";
const proof = "A".repeat(43);
const brand: Brand = {
  id: "brand_facejamas",
  name: "FACEJAMAS",
  slug: "facejamas",
  category: "Gifts",
  domain: "facejamas.com",
  accent: "#7c4dff",
  logoInitial: "F",
  checkoutTitle: "Checkout",
  announcement: "",
  supportEmail: "",
  shippingPrice: 0,
  freeShippingThreshold: 0,
  status: "draft",
  mode: "demo",
  shopify: { status: "verified", account: "facejamas.myshopify.com" },
  whop: { status: "verified", account: "biz_facejamas" },
  products: [{ id: "gid://shopify/ProductVariant/54933535916245", variantId: "gid://shopify/ProductVariant/54933535916245", title: "FaceJamas Pajamas", description: "", price: 69, available: true }],
  accountDetails: { shopifyDomain: "facejamas.myshopify.com", shopifyAliases: [], whopCompanyId: "biz_facejamas", storefrontAliases: [], customerAccountDomain: "" },
  createdAt: "2026-09-13T00:00:00.000Z",
};

async function fixture() {
  const db = new Store(":memory:");
  db.db.exec(`CREATE TABLE IF NOT EXISTS facejamas_upload_receipts (
    ref TEXT PRIMARY KEY, proof_hash TEXT NOT NULL, content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL, attempt_id TEXT, order_id TEXT, attached_at TEXT
  )`);
  await db.database.run(
    "INSERT INTO facejamas_upload_receipts (ref, proof_hash, content_type, size_bytes, sha256, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ref,
    createHash("sha256").update(proof).digest("hex"),
    "image/jpeg",
    "1024",
    "b".repeat(64),
    "2026-10-13T00:00:00.000Z",
    "2026-09-13T00:00:00.000Z",
  );
  return db;
}

async function encrypted<T>(fn: () => Promise<T>) {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = "ab".repeat(32);
  try { return await fn(); }
  finally { if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY; else process.env.CREDENTIAL_ENCRYPTION_KEY = previous; }
}

test("FaceJamas verifies private upload proof before cart encryption and strips proof from the token", async () => encrypted(async () => {
  const db = await fixture();
  try {
    const input = { items: [{ variantId: "54933535916245", quantity: 1, personalizationRef: ref, personalizationProof: proof }] };
    await verifyFaceJamasCartPersonalizations(db, brand, input.items, Date.parse("2026-09-14T00:00:00.000Z"));
    const created = createCartSession(brand, input, Date.parse("2026-09-14T00:00:00.000Z"));
    assert.deepEqual(created.items, [{ productId: "gid://shopify/ProductVariant/54933535916245", quantity: 1, personalizationRef: ref }]);
    const decoded = readCartSession(brand, created.token, Date.parse("2026-09-14T00:01:00.000Z"));
    assert.equal(decoded.items[0].personalizationRef, ref);
    assert.equal("personalizationProof" in decoded.items[0], false);
  } finally { await db.close(); }
}));

test("FaceJamas rejects forged proof and non-FaceJamas brands reject personalization data", async () => {
  const db = await fixture();
  try {
    await assert.rejects(() => verifyFaceJamasCartPersonalizations(db, brand, [{ personalizationRef: ref, personalizationProof: "B".repeat(43) }], Date.parse("2026-09-14T00:00:00.000Z")), /could not be verified/i);
    await assert.rejects(() => verifyFaceJamasCartPersonalizations(db, { ...brand, slug: "chefings" }, [{ personalizationRef: ref, personalizationProof: proof }]), /only supported for FaceJamas/i);
  } finally { await db.close(); }
});

test("FaceJamas artwork can be retried by one attempt but not reused by another and binds to one Shopify order", async () => {
  const db = await fixture();
  try {
    await claimFaceJamasPersonalizations(db, brand.id, [ref], "attempt_11111111-1111-4111-8111-111111111111", Date.parse("2026-09-14T00:00:00.000Z"));
    await claimFaceJamasPersonalizations(db, brand.id, [ref], "attempt_11111111-1111-4111-8111-111111111111", Date.parse("2026-09-14T00:01:00.000Z"));
    await assert.rejects(() => claimFaceJamasPersonalizations(db, brand.id, [ref], "attempt_22222222-2222-4222-8222-222222222222", Date.parse("2026-09-14T00:02:00.000Z")), /another checkout/i);
    await finalizeFaceJamasPersonalizations(db, [ref], "attempt_11111111-1111-4111-8111-111111111111", "gid://shopify/Order/12345");
    await finalizeFaceJamasPersonalizations(db, [ref], "attempt_11111111-1111-4111-8111-111111111111", "gid://shopify/Order/12345");
    await assert.rejects(() => finalizeFaceJamasPersonalizations(db, [ref], "attempt_11111111-1111-4111-8111-111111111111", "gid://shopify/Order/99999"), /different Shopify order/i);
  } finally { await db.close(); }
});
