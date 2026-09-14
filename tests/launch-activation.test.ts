import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../lib/server/store";
import { PaymentAttempts } from "../lib/server/payment-attempts";
import { activateLiveCheckout, launchReadiness, recordLaunchAcceptance } from "../lib/server/launch-activation";

async function environment(values: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { await fn(); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

async function completedAttempt(db: Store, brandId: string) {
  const ledger = new PaymentAttempts(db.database);
  let attempt = await ledger.prepare({ brandId, key: "launch_acceptance_key", shopifyDomain: "test.myshopify.com", whopCompanyId: "biz_test", totalCents: 1000, cartFingerprint: "acceptance" });
  attempt = await ledger.beginDraft(brandId, attempt.id);
  attempt = await ledger.bindDraft(brandId, attempt.id, "gid://shopify/DraftOrder/1");
  attempt = await ledger.bindCheckout(brandId, attempt.id, "ch_test", Date.now(), "https://whop.com/checkout/test");
  attempt = await ledger.acceptVerifiedPayment(brandId, attempt.id, "pay_test");
  attempt = await ledger.claimCompletion(brandId, attempt.id);
  return ledger.complete(brandId, attempt.id, "gid://shopify/Order/1", attempt.completionLease!.token);
}

test("live activation requires a completed acceptance attempt and both explicit payment gates", async () => {
  await environment({ CREDENTIAL_ENCRYPTION_KEY: "ab".repeat(32), PAYMENT_ACCEPTANCE_ENABLED: undefined, PUBLIC_PAYMENT_ENABLED: undefined }, async () => {
    const db = new Store(":memory:");
    try {
      await db.ready;
      const brand = await db.brand("brand_1");
      brand.domain = "brand.example";
      brand.shippingPrice = 0;
      brand.freeShippingThreshold = 0;
      brand.shopify = { status: "verified", account: "test.myshopify.com" };
      brand.whop = { status: "verified", account: "biz_test" };
      brand.products = [{ id: "gid://shopify/ProductVariant/1", variantId: "gid://shopify/ProductVariant/1", title: "Product", description: "", price: 10, available: true }];
      brand.checkoutExperience = { showPaymentMethods: true, showTrustBadges: true, showReview: false, reviewQuote: "", reviewAuthor: "", reviewRating: 5, reviewConfirmed: false, deliveryText: "Free standard shipping", returnsText: "", showFaq: false, discountCode: "", discountPercent: 0, allowTips: false, priorityEnabled: true, priorityLabel: "Priority processing", priorityPrice: 4.99, bumpProductId: "", offerEndsAt: "", offerText: "" };
      await db.saveBrand(brand);
      await db.setCredential(brand.id, "shopify", { domain: "test.myshopify.com", accessToken: "synthetic" });
      await db.setCredential(brand.id, "whop", { companyId: "biz_test", apiKey: "synthetic", webhookSecret: "ws_synthetic" });
      const attempt = await completedAttempt(db, brand.id);

      await assert.rejects(recordLaunchAcceptance(db, brand.id, attempt.id), /not enabled/i);
      process.env.PAYMENT_ACCEPTANCE_ENABLED = "true";
      await recordLaunchAcceptance(db, brand.id, attempt.id);
      let readiness = await launchReadiness(db, brand.id);
      assert.equal(readiness.checks.controlledAcceptanceCompleted, true);
      assert.equal(readiness.checks.publicPaymentEnabled, false);
      assert.equal(readiness.ready, false);
      await assert.rejects(activateLiveCheckout(db, brand.id), /publicPaymentEnabled/);

      process.env.PUBLIC_PAYMENT_ENABLED = "true";
      readiness = await launchReadiness(db, brand.id);
      assert.equal(readiness.ready, true);
      const live = await activateLiveCheckout(db, brand.id);
      assert.equal(live.status, "live");
      assert.equal(live.mode, "live");
    } finally { await db.close(); }
  });
});

test("launch acceptance is invalidated when launch-critical brand configuration changes", async () => {
  await environment({ CREDENTIAL_ENCRYPTION_KEY: "cd".repeat(32), PAYMENT_ACCEPTANCE_ENABLED: "true", PUBLIC_PAYMENT_ENABLED: "true" }, async () => {
    const db = new Store(":memory:");
    try {
      await db.ready;
      const brand = await db.brand("brand_1");
      brand.domain = "brand.example";
      brand.shippingPrice = 0;
      brand.freeShippingThreshold = 0;
      brand.shopify = { status: "verified", account: "test.myshopify.com" };
      brand.whop = { status: "verified", account: "biz_test" };
      brand.products = [{ id: "gid://shopify/ProductVariant/1", variantId: "gid://shopify/ProductVariant/1", title: "Product", description: "", price: 10, available: true }];
      brand.checkoutExperience = { showPaymentMethods: true, showTrustBadges: true, showReview: false, reviewQuote: "", reviewAuthor: "", reviewRating: 5, reviewConfirmed: false, deliveryText: "Free standard shipping", returnsText: "", showFaq: false, discountCode: "", discountPercent: 0, allowTips: false, priorityEnabled: true, priorityLabel: "Priority processing", priorityPrice: 4.99, bumpProductId: "", offerEndsAt: "", offerText: "" };
      await db.saveBrand(brand);
      await db.setCredential(brand.id, "shopify", { domain: "test.myshopify.com", accessToken: "synthetic" });
      await db.setCredential(brand.id, "whop", { companyId: "biz_test", apiKey: "synthetic", webhookSecret: "ws_synthetic" });
      const attempt = await completedAttempt(db, brand.id);
      await recordLaunchAcceptance(db, brand.id, attempt.id);
      assert.equal((await launchReadiness(db, brand.id)).ready, true);

      const changed = await db.brand(brand.id);
      changed.checkoutExperience = { ...changed.checkoutExperience!, priorityPrice: 5.99 };
      await db.saveBrand(changed);
      const readiness = await launchReadiness(db, brand.id);
      assert.equal(readiness.checks.controlledAcceptanceCompleted, false);
      assert.equal(readiness.checks.launchShippingPolicy, false);
      assert.equal(readiness.ready, false);
      await assert.rejects(activateLiveCheckout(db, brand.id), /controlledAcceptanceCompleted|launchShippingPolicy/);
    } finally { await db.close(); }
  });
});
