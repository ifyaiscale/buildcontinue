import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../lib/server/store";
import { PaymentAttempts } from "../lib/server/payment-attempts";
import { createCustomerReceipt, customerCheckoutInput, customerPaymentStatus, publicPaymentEnabled } from "../lib/server/customer-checkout";
import { handleApi } from "../lib/server/api";
import { route } from "../lib/server/http";

async function withEnvironment(values: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { await fn(); }
  finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

test("customer payment has an independent fail-closed public gate", async () => {
  await withEnvironment({ PAYMENT_ACCEPTANCE_ENABLED: "true", PUBLIC_PAYMENT_ENABLED: undefined }, () => assert.equal(publicPaymentEnabled(), false));
  await withEnvironment({ PAYMENT_ACCEPTANCE_ENABLED: undefined, PUBLIC_PAYMENT_ENABLED: "true" }, () => assert.equal(publicPaymentEnabled(), false));
  await withEnvironment({ PAYMENT_ACCEPTANCE_ENABLED: "true", PUBLIC_PAYMENT_ENABLED: "true" }, () => assert.equal(publicPaymentEnabled(), true));
});

test("shopper payment API remains locked before any provider work when public activation is off", async () => {
  const checkoutOrigin = "https://checkout.example";
  const globals = globalThis as typeof globalThis & { limitlessStore?: Store };
  const previousStore = globals.limitlessStore;
  const db = new Store(":memory:");
  await db.ready;
  globals.limitlessStore = db;
  try {
    await withEnvironment({
      NODE_ENV: "production",
      APP_URL: "https://admin.example",
      CHECKOUT_ORIGINS: JSON.stringify({ [checkoutOrigin]: "aure-studio" }),
      ADMIN_PASSWORD: "synthetic-test-password",
      ADMIN_PASSWORD_HASH: undefined,
      SESSION_SECRET: "s".repeat(48),
      PAYMENT_ACCEPTANCE_ENABLED: "true",
      PUBLIC_PAYMENT_ENABLED: undefined,
    }, async () => {
      const response = await route(handleApi)(new Request(`${checkoutOrigin}/api/checkout/aure-studio/payment-start`, {
        method: "POST",
        headers: {
          origin: checkoutOrigin,
          "content-type": "application/json",
          "idempotency-key": "customer_gate_test",
        },
        body: "{}",
      }));
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /not enabled yet/i);
      assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM payment_attempts").get()?.n, 0);
    });
  } finally {
    globals.limitlessStore = previousStore;
    await db.close();
  }
});

test("customer checkout input cannot inject products, prices, totals or payment identifiers", () => {
  const shippingAddress = { firstName: "Test", lastName: "Buyer", address1: "123 Example Street", city: "Portland", zip: "97201", provinceCode: "OR", countryCode: "US" };
  const valid = { cartToken: "x".repeat(40), email: "buyer@example.com", priority: false, shippingAddress };
  assert.equal(customerCheckoutInput.safeParse(valid).success, true);
  for (const injected of [
    { ...valid, items: [{ productId: "other", quantity: 99 }] },
    { ...valid, totalCents: 1 },
    { ...valid, price: 0 },
    { ...valid, paymentId: "pay_fake" },
  ]) assert.equal(customerCheckoutInput.safeParse(injected).success, false);
});

test("encrypted customer receipt resolves only its brand and idempotent attempt", async () => {
  await withEnvironment({ CREDENTIAL_ENCRYPTION_KEY: "ab".repeat(32) }, async () => {
    const db = new Store(":memory:");
    try {
      await db.ready;
      const brand = await db.brand("brand_1");
      const now = Date.UTC(2026, 8, 13, 21, 0, 0);
      const key = "customer_checkout_key";
      const ledger = new PaymentAttempts(db.database);
      const attempt = await ledger.prepare({ brandId: brand.id, key, shopifyDomain: "test.myshopify.com", whopCompanyId: "biz_test", totalCents: 1250, cartFingerprint: "cart" }, now);
      assert.deepEqual(await ledger.getByKey(brand.id, key), attempt);
      const receipt = createCustomerReceipt(brand, key, now);
      const status = await customerPaymentStatus(db, brand.slug, receipt, now + 1000);
      assert.deepEqual(status, { status: "awaiting_payment", totalCents: 1250, currency: "USD", expiresAt: attempt.expiresAt });
      const tampered = `${receipt.slice(0, -1)}${receipt.endsWith("A") ? "B" : "A"}`;
      await assert.rejects(customerPaymentStatus(db, brand.slug, tampered, now + 1000), /invalid/i);
      const other = await db.brand("brand_2");
      await assert.rejects(customerPaymentStatus(db, other.slug, receipt, now + 1000), /invalid|belong/i);
      assert.equal((await customerPaymentStatus(db, brand.slug, receipt, now + 16 * 60_000)).status, "expired");
    } finally { await db.close(); }
  });
});
