import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { Pool } from "pg";
import { PostgresDatabase, postgresConfig } from "../lib/server/database";
import { Store, store } from "../lib/server/store";
import { demoMode, sessionCookie } from "../lib/server/security";
import { state } from "../lib/server/api";
import { supabaseCertificate } from "../lib/server/supabase-ca";

test("bundled Supabase CA matches the vendor fingerprint and is only used for Supabase hosts", () => {
  const certificate = new X509Certificate(supabaseCertificate);
  assert.equal(certificate.fingerprint256, "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
  assert.ok(Date.parse(certificate.validTo) > Date.now());
  assert.deepEqual(postgresConfig("postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres").ssl, { rejectUnauthorized: true, ca: supabaseCertificate });
  assert.deepEqual(postgresConfig("postgresql://user:password@other.example:5432/postgres").ssl, { rejectUnauthorized: true });
});

test("PostgreSQL configuration verifies TLS and refuses URL security overrides", () => {
  const url = "postgresql://postgres.project:synthetic-password@localhost:6543/postgres";
  const config = postgresConfig(`${url}?sslmode=require`, "certificate\\ncontents");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: "certificate\ncontents" });
  assert.equal(config.connectionString, url);
  assert.equal(config.max, 2);
  const punctuationPassword = url.replace("synthetic-password", "encoded%5Bpassword%5D%40%23%25");
  assert.equal(postgresConfig(punctuationPassword).connectionString, punctuationPassword);
  for (const invalid of ["", "https://example.com", `${url}?sslmode=no-verify`, `${url}?sslmode=disable`, `${url}?sslrootcert=/tmp/cert`, url.replace("synthetic-password", "[YOUR-PASSWORD]")]) {
    assert.throws(() => postgresConfig(invalid), /Database connection settings are invalid/);
  }
});

test("remote database configuration cannot become an unauthenticated public demo", async () => {
  const original = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = "";
    assert.equal(demoMode(), false);
    assert.equal((await state(new Request("http://localhost:3000/api/state"))).status, 503);
    await assert.rejects(() => store(), /Database connection settings are invalid/);
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
  }
});

test("Netlify refuses ephemeral SQLite fallback", async () => {
  const original = process.env.NETLIFY;
  try {
    process.env.NETLIFY = "true";
    assert.equal(demoMode(), false);
    await assert.rejects(() => store(), /Configure DATABASE_URL/);
  } finally {
    if (original === undefined) delete process.env.NETLIFY; else process.env.NETLIFY = original;
  }
});

test("changing database configuration cannot silently reuse a cached local database", async () => {
  const globals = globalThis as typeof globalThis & { limitlessStore?: Store; limitlessStoreKey?: string };
  const previous = globals.limitlessStore; const previousKey = globals.limitlessStoreKey;
  const path = process.env.DATABASE_PATH; const url = process.env.DATABASE_URL;
  let db: Store | undefined;
  try {
    delete globals.limitlessStore; delete globals.limitlessStoreKey;
    process.env.DATABASE_PATH = ":memory:";
    db = await store();
    process.env.DATABASE_URL = "postgresql://user:password@localhost:6543/postgres";
    await assert.rejects(() => store(), /Database settings changed/);
  } finally {
    await db?.close();
    globals.limitlessStore = previous; globals.limitlessStoreKey = previousKey;
    if (path === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = path;
    if (url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = url;
  }
});

const testUrl = process.env.TEST_DATABASE_URL;
test("PostgreSQL storage integration in an explicitly isolated local database", { skip: !testUrl }, async t => {
  const url = new URL(testUrl!);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Integration tests require a local database.");
  assert.match(url.pathname, /^\/limitless_test_[a-z0-9_]+$/, "Use a dedicated limitless_test_* database.");
  const config = { connectionString: testUrl, max: 3, connectionTimeoutMillis: 5000 };
  const admin = new Pool(config);
  const schema = await admin.query("SELECT to_regnamespace('limitless') AS schema");
  assert.equal(schema.rows[0].schema, null, "The integration database must start empty.");
  let db: Store | undefined; let second: Store | undefined;
  const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = "ab".repeat(32);
  try {
    await admin.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$");
    const migration = await readFile(new URL("../migrations/001_supabase.sql", import.meta.url), "utf8");
    await admin.query(migration);
    db = new Store(undefined, new PostgresDatabase(new Pool(config)));
    second = new Store(undefined, new PostgresDatabase(new Pool(config)));
    await Promise.all([db.ready, second.ready]);
    const first = db; const other = second;

    await t.test("starts empty and migrations are repeatable without deleting records", async () => {
      assert.deepEqual(await first.brands(), []);
      assert.deepEqual(await first.orders(), []);
      assert.deepEqual(await first.activity(), []);
      await first.createBrand({ name: "Test Brand", category: "Testing" });
      await admin.query(migration);
      assert.equal((await first.brands()).length, 1);
    });
    const brand = (await first.brands())[0];

    await t.test("concurrent instances allocate unique slugs and preserve updates", async () => {
      const brands = await Promise.all([first.createBrand({ name: "Concurrent", category: "Testing" }), other.createBrand({ name: "Concurrent", category: "Testing" })]);
      assert.deepEqual(brands.map(item => item.slug).sort(), ["concurrent", "concurrent-2"]);
      await Promise.all([first.addTestProduct(brand.id, { title: "One", price: 10 }), other.addTestProduct(brand.id, { title: "Two", price: 20 })]);
      assert.equal((await first.brand(brand.id)).products.length, 2);
    });

    await t.test("credential ciphertext persists and transactions roll back as a unit", async () => {
      await first.setCredential(brand.id, "shopify", { accessToken: "synthetic-provider-token" });
      const row = await admin.query("SELECT data FROM limitless.credentials WHERE brand_id=$1", [brand.id]);
      assert.equal(row.rows[0].data.includes("synthetic-provider-token"), false);
      assert.deepEqual(await other.credential(brand.id, "shopify"), { accessToken: "synthetic-provider-token" });
      const original = await first.brand(brand.id);
      const activity = (await first.activity()).length;
      await assert.rejects(first.transaction(async () => {
        await first.saveBrand({ ...original, name: "Must roll back" });
        await first.addActivity("Must roll back", "brand", brand.id);
        await first.setCredential(brand.id, "shopify", { accessToken: "replacement" });
        throw new Error("deliberate rollback");
      }), /deliberate rollback/);
      assert.deepEqual(await other.brand(brand.id), original);
      assert.equal((await other.activity()).length, activity);
      assert.deepEqual(await other.credential(brand.id, "shopify"), { accessToken: "synthetic-provider-token" });
    });

    await t.test("concurrent checkout retries create exactly one order and reject changed input", async () => {
      const published = await first.publish(brand.id, "demo");
      const input = { mode: "demo", items: [{ productId: published.products[0].id, quantity: 1 }], customer: { firstName: "Test", lastName: "Shopper", email: "shopper@example.com", address: "1 Test Street", city: "Austin", postalCode: "78701", country: "US" } };
      const orders = await Promise.all([first.checkout(brand.slug, input, false, "same-key-123"), other.checkout(brand.slug, input, false, "same-key-123")]);
      assert.equal(orders[0].orderId, orders[1].orderId);
      assert.equal((await other.orders()).length, 1);
      await assert.rejects(other.checkout(brand.slug, { ...input, items: [{ productId: published.products[0].id, quantity: 2 }] }, false, "same-key-123"), /different order/);
      await assert.rejects(first.publish(brand.id, "live"), /Live checkout is not enabled/);
    });

    await t.test("anonymous and authenticated Data API roles cannot access private tables", async () => {
      const rls = await admin.query("SELECT bool_and(relrowsecurity) AS enabled FROM pg_class WHERE relnamespace='limitless'::regnamespace AND relkind='r'");
      assert.equal(rls.rows[0].enabled, true);
      for (const role of ["anon", "authenticated"]) {
        const client = await admin.connect();
        try {
          await client.query("BEGIN");
          await client.query(`SET LOCAL ROLE ${role}`);
          await assert.rejects(client.query("SELECT * FROM limitless.brands"), { code: "42501" });
        } finally { await client.query("ROLLBACK"); client.release(); }
      }
    });

    await t.test("the authenticated API awaits PostgreSQL results and keeps live payments disabled", async () => {
      const globals = globalThis as typeof globalThis & { limitlessStore?: Store };
      const previous = globals.limitlessStore;
      const password = process.env.ADMIN_PASSWORD; const secret = process.env.SESSION_SECRET;
      globals.limitlessStore = first;
      process.env.ADMIN_PASSWORD = "synthetic-admin-password";
      process.env.SESSION_SECRET = "synthetic-session-secret".repeat(3);
      try {
        assert.equal((await state(new Request("http://localhost:3000/api/state"))).status, 401);
        const response = await state(new Request("http://localhost:3000/api/state", { headers: { cookie: sessionCookie().split(";")[0] } }));
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.brands.length, 3);
        assert.equal(payload.orders.length, 1);
        assert.equal(payload.environment.liveEnabled, false);
        assert.equal(JSON.stringify(payload).includes("synthetic-provider-token"), false);
      } finally {
        globals.limitlessStore = previous;
        if (password === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = password;
        if (secret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = secret;
      }
    });

    await t.test("records survive closing and reopening the application pool", async () => {
      await other.close();
      second = new Store(undefined, new PostgresDatabase(new Pool(config)));
      await second.ready;
      assert.equal((await second.brand(brand.id)).products.length, 2);
      assert.equal((await second.orders()).length, 1);
    });
  } finally {
    if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY; else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
    await db?.close(); await second?.close();
    await admin.query("DROP SCHEMA limitless CASCADE");
    await admin.end();
  }
});
