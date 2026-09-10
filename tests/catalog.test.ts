import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../lib/server/store";
import { route } from "../lib/server/http";
import { handleApi } from "../lib/server/api";

test("new brand can add a test product, publish, and complete an order through the API", async () => {
  const keys = [
    "NODE_ENV",
    "ADMIN_PASSWORD",
    "ADMIN_PASSWORD_HASH",
    "SESSION_SECRET",
    "CREDENTIAL_ENCRYPTION_KEY",
    "APP_URL",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  const globals = globalThis as typeof globalThis & { limitlessStore?: Store };
  const previousStore = globals.limitlessStore;
  const db = new Store(":memory:");
  await db.ready;
  globals.limitlessStore = db;
  const handler = route(handleApi);
  const post = (path: string, body: unknown) =>
    handler(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify(body),
      }),
    );
  try {
    keys.forEach((key) => delete process.env[key]);
    Object.assign(process.env, { NODE_ENV: "development" });
    const created = await post("/api/brands", {
      name: "My New Brand",
      category: "Home",
      accent: "#445544",
    });
    assert.equal(created.status, 201);
    const brand = await created.json();
    const added = await post(`/api/brands/${brand.id}/products`, {
      title: "Test Candle",
      description: "A sample product",
      price: 29.95,
    });
    assert.equal(added.status, 201);
    const updated = await added.json();
    assert.equal(updated.products.length, 1);
    assert.equal(updated.products[0].variantId, undefined);
    assert.equal(
      (await post(`/api/brands/${brand.id}/publish`, { mode: "demo" })).status,
      200,
    );
    const ordered = await post(`/api/checkout/${brand.slug}`, {
      mode: "demo",
      items: [{ productId: updated.products[0].id, quantity: 2 }],
      customer: {
        email: "test@example.com",
        firstName: "Test",
        lastName: "Buyer",
        address: "1 Example Street",
        city: "Portland",
        postalCode: "97201",
        country: "US",
      },
    });
    assert.equal(ordered.status, 201);
    const result = await ordered.json();
    assert.equal(result.total, 64.9);
    assert.equal(result.mode, "demo");
    assert.equal(
      (await db.orders()).find((order) => order.id === result.orderId)?.brandId,
      brand.id,
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globals.limitlessStore = previousStore;
    db.db.close();
  }
});

test("manual products reject invalid prices, injected fields, and live brands", async () => {
  const db = new Store(":memory:");
  await db.ready;
  try {
    for (const price of [-1, 0, Infinity, 0.001, 100001]) {
      await assert.rejects(async () =>
        await db.addTestProduct("brand_1", {
          title: "Sample",
          description: "",
          price,
        }),
      );
    }
    await assert.rejects(async () =>
      await db.addTestProduct("brand_1", {
        title: "Sample",
        price: 20,
        variantId: "malicious",
      }),
    );
    const brand = await db.brand("brand_1");
    brand.mode = "live";
    await db.saveBrand(brand);
    await assert.rejects(
      async () => await db.addTestProduct(brand.id, { title: "Sample", price: 20 }),
      /only available in demo/,
    );
  } finally {
    db.db.close();
  }
});
