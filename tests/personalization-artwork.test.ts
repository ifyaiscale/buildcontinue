import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Store } from "../lib/server/store";
import { listFaceJamasFulfillmentArtwork, openFaceJamasArtwork } from "../lib/server/personalization";

const ref = "pers_123e4567-e89b-42d3-a456-426614174000";

async function fixture(orderId: string | null) {
  const db = new Store(":memory:");
  db.db.exec(`
    CREATE TABLE facejamas_upload_receipts (
      ref TEXT PRIMARY KEY, proof_hash TEXT NOT NULL, content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL, attempt_id TEXT, order_id TEXT, attached_at TEXT
    );
    CREATE TABLE facejamas_asset_access (
      token_hash TEXT PRIMARY KEY, ref TEXT NOT NULL, expires_at TEXT NOT NULL,
      consumed_at TEXT, created_at TEXT NOT NULL
    );
  `);
  await db.database.run(
    "INSERT INTO facejamas_upload_receipts (ref, proof_hash, content_type, size_bytes, sha256, expires_at, created_at, attempt_id, order_id, attached_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ref,
    createHash("sha256").update("proof").digest("hex"),
    "image/jpeg",
    "1000",
    "b".repeat(64),
    "2026-10-13T00:00:00.000Z",
    "2026-09-13T00:00:00.000Z",
    "attempt_11111111-1111-4111-8111-111111111111",
    orderId ?? "",
    "2026-09-14T00:02:00.000Z",
  );
  if (orderId === null) await db.database.run("UPDATE facejamas_upload_receipts SET order_id = NULL WHERE ref = ?", ref);
  return db;
}

async function withEnv<T>(fn: () => Promise<T>) {
  const previousKey = process.env.SUPABASE_PUBLIC_ANON_KEY;
  const previousUrl = process.env.FACEJAMAS_ASSET_URL;
  process.env.SUPABASE_PUBLIC_ANON_KEY = "public-anon-key";
  process.env.FACEJAMAS_ASSET_URL = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/facejamas-asset";
  try { return await fn(); }
  finally {
    if (previousKey === undefined) delete process.env.SUPABASE_PUBLIC_ANON_KEY; else process.env.SUPABASE_PUBLIC_ANON_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.FACEJAMAS_ASSET_URL; else process.env.FACEJAMAS_ASSET_URL = previousUrl;
  }
}

test("fulfillment list exposes only order-bound IDs, not proof hashes or object paths", async () => {
  const db = await fixture("gid://shopify/Order/12345");
  try {
    const items = await listFaceJamasFulfillmentArtwork(db);
    assert.deepEqual(items, [{
      personalizationRef: ref,
      orderId: "gid://shopify/Order/12345",
      attachedAt: "2026-09-14T00:02:00.000Z",
      createdAt: "2026-09-13T00:00:00.000Z",
    }]);
  } finally { await db.close(); }
});

test("ordered artwork creates a hashed one-time token and returns only a trusted five-minute signed URL", async () => withEnv(async () => {
  const db = await fixture("gid://shopify/Order/12345");
  let submittedToken = "";
  try {
    const result = await openFaceJamasArtwork(
      db,
      ref,
      Date.parse("2026-09-14T00:03:00.000Z"),
      async (_input, init) => {
        const body = JSON.parse(String(init?.body || "{}"));
        submittedToken = body.token;
        assert.match(submittedToken, /^[A-Za-z0-9_-]{40,100}$/);
        assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer public-anon-key");
        return Response.json({
          signedUrl: `https://ifwljlzrhfmviwhsjhpp.supabase.co/storage/v1/object/sign/personalization-assets/${ref}/source.jpg?token=short-lived`,
          expiresIn: 300,
          personalizationRef: ref,
        });
      },
    );
    assert.equal(result.orderId, "gid://shopify/Order/12345");
    assert.equal(result.expiresAt, "2026-09-14T00:08:00.000Z");
    const access = await db.database.get("SELECT token_hash, ref, consumed_at FROM facejamas_asset_access WHERE ref = ?", ref);
    assert.equal(access?.ref, ref);
    assert.equal(access?.consumed_at, null);
    assert.equal(access?.token_hash, createHash("sha256").update(submittedToken).digest("hex"));
    assert.notEqual(access?.token_hash, submittedToken);
  } finally { await db.close(); }
}));

test("unbound FaceJamas uploads cannot be opened by fulfillment", async () => withEnv(async () => {
  const db = await fixture(null);
  try {
    await assert.rejects(() => openFaceJamasArtwork(db, ref, Date.parse("2026-09-14T00:03:00.000Z"), async () => Response.json({})), /only be opened after it is bound/i);
  } finally { await db.close(); }
}));
