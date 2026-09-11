import test from "node:test";
import assert from "node:assert/strict";
import { calculateLaunchQuote, launchQuoteInput } from "../lib/server/launch-quote";
import { Store } from "../lib/server/store";
import { handleApi } from "../lib/server/api";
import { route } from "../lib/server/http";
import { sessionCookie } from "../lib/server/security";

const credentials = { domain: "test.myshopify.com", accessToken: "synthetic-token" };
const variantId = "gid://shopify/ProductVariant/123";
const input = { items: [{ productId: "imported", quantity: 2 }], shippingAddress: { firstName: "Test", lastName: "Buyer", address1: "123 Example Street", city: "Portland", provinceCode: "OR", zip: "97201", countryCode: "US" } };
const bag = (cents: number) => ({ shopMoney: { amount: (cents / 100).toFixed(2), currencyCode: "USD" }, presentmentMoney: { amount: (cents / 100).toFixed(2), currencyCode: "USD" } });
const variant = () => ({ id: variantId, availableForSale: true, sellableOnlineQuantity: 10, inventoryPolicy: "DENY", inventoryItem: { tracked: true, requiresShipping: true }, requiresComponents: false, product: { status: "ACTIVE", isGiftCard: false, requiresSellingPlan: false } });
function draft(priority: boolean, included = false) {
  const subtotal = 5998 + (priority ? 499 : 0);
  return { subtotalPriceSet: bag(subtotal), totalShippingPriceSet: bag(0), totalTaxSet: bag(600), totalDiscountsSet: bag(0), totalPriceSet: bag(subtotal + (included ? 0 : 600)), taxesIncluded: included,
    shippingLine: { title: "Free standard shipping", shippingRateHandle: null as string | null }, warnings: [] as { errorCode: string; field: string; message: string }[],
    lineItems: [
      { variant: { id: variantId } as { id: string } | null, quantity: 2, custom: false, title: "Product", requiresShipping: true, taxable: true, originalUnitPriceSet: bag(2999), components: [] as { quantity: number }[] },
      ...(priority ? [{ variant: null, quantity: 1, custom: true, title: "Priority processing", requiresShipping: false, taxable: true, originalUnitPriceSet: bag(499), components: [] as { quantity: number }[] }] : []),
    ],
  };
}
type Draft = ReturnType<typeof draft>;
function mock(options: { variant?: (node: ReturnType<typeof variant>) => void; draft?: (value: Draft) => void | Promise<void>; included?: boolean; fail?: boolean } = {}) {
  const calls: { query: string; variables: { input?: { lineItems: Record<string, unknown>[]; [key: string]: unknown }; ids?: string[] } }[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://test.myshopify.com/admin/api/2026-07/graphql.json");
    const call = JSON.parse(String(init?.body)); calls.push(call);
    assert.doesNotMatch(call.query, /draftOrderCreate|draftOrderComplete|orderCreate/);
    if (call.query.includes("currentAppInstallation")) return Response.json({ data: { shop: { name: "Test", myshopifyDomain: credentials.domain, currencyCode: "USD" }, currentAppInstallation: { accessScopes: ["read_products", "read_inventory", "write_draft_orders"].map(handle => ({ handle })) } } });
    if (call.query.includes("LimitlessLaunchAvailability")) { const node = variant(); options.variant?.(node); return Response.json({ data: { nodes: [node] } }); }
    if (options.fail) throw new Error("synthetic outage");
    const value = draft(call.variables.input.lineItems.length === 2, options.included); await options.draft?.(value);
    return Response.json({ data: { draftOrderCalculate: { userErrors: [], calculatedDraftOrder: value } } });
  };
  return calls;
}
async function fixture(fn: (db: Store) => Promise<void>) {
  const original = globalThis.fetch; const db = new Store(":memory:");
  const brand = await db.brand("brand_1");
  Object.assign(brand, { shippingPrice: 0, freeShippingThreshold: 0, shopify: { status: "verified", account: credentials.domain }, checkoutExperience: { priorityEnabled: true, priorityPrice: 4.99 }, products: [{ id: "imported", variantId, title: "Synthetic", description: "", available: true, price: 0.01 }] });
  await db.saveBrand(brand);
  try { await fn(db); } finally { globalThis.fetch = original; await db.close(); }
}

test("launch input rejects buyer prices, shipping rates, unsupported options and duplicate products", () => {
  assert.equal(launchQuoteInput.parse(input).priority, false);
  for (const extra of [{ total: 1 }, { shippingRateHandle: "free" }, { priorityPrice: 0 }, { discountCode: "FREE" }, { priority: "true" }, { items: [...input.items, ...input.items] }]) assert.equal(launchQuoteInput.safeParse({ ...input, ...extra }).success, false);
});

test("fresh Shopify pricing includes free shipping and priority exactly once; deselection removes it", async () => fixture(async db => {
  const before = db.db.prepare("SELECT total_changes() AS count").get();
  for (const priority of [false, true, false]) {
    const calls = mock(); const result = await calculateLaunchQuote(await db.brand("brand_1"), credentials, { ...input, priority });
    assert.equal(result.totals.subtotalCents, 5998); assert.equal(result.totals.shippingCents, 0);
    assert.equal(result.totals.priorityCents, priority ? 499 : 0); assert.equal(result.totals.totalCents, priority ? 7097 : 6598);
    assert.equal(result.paymentReady, false); assert.equal(calls.length, 3);
    assert.deepEqual(calls[1].variables.ids, [variantId]);
    assert.deepEqual(calls[2].variables.input?.shippingLine, { title: "Free standard shipping", priceWithCurrency: { amount: "0.00", currencyCode: "USD" } });
    assert.deepEqual(calls[2].variables.input?.lineItems[0], { variantId, quantity: 2 });
    assert.equal(calls[2].variables.input?.lineItems.length, priority ? 2 : 1);
    if (priority) assert.deepEqual(calls[2].variables.input?.lineItems[1], { title: "Priority processing", quantity: 1, requiresShipping: false, taxable: true, originalUnitPriceWithCurrency: { amount: "4.99", currencyCode: "USD" } });
    assert.doesNotMatch(JSON.stringify(result), /synthetic-token|123 Example Street|myshopify/);
  }
  assert.deepEqual(db.db.prepare("SELECT total_changes() AS count").get(), before);
}));

test("tax-inclusive totals avoid double tax; zero tax must be supplied explicitly", async () => fixture(async db => {
  mock({ included: true });
  let result = await calculateLaunchQuote(await db.brand("brand_1"), credentials, { ...input, priority: true });
  assert.equal(result.totals.totalCents, 6497); assert.equal(result.totals.taxCents, 600);
  mock({ draft: d => { d.totalTaxSet = bag(0); d.totalPriceSet = bag(5998); } });
  result = await calculateLaunchQuote(await db.brand("brand_1"), credentials, input);
  assert.equal(result.totals.totalCents, 5998); assert.equal(result.totals.taxCents, 0);
  mock({ draft: d => { Reflect.deleteProperty(d, "totalTaxSet"); } });
  await assert.rejects(calculateLaunchQuote(await db.brand("brand_1"), credentials, input), /incomplete/);
}));

test("availability checks block sold-out, excessive quantities, bundles, subscriptions, digital and inactive products", async () => fixture(async db => {
  for (const mutate of [
    (v: ReturnType<typeof variant>) => { v.availableForSale = false; },
    (v: ReturnType<typeof variant>) => { v.sellableOnlineQuantity = 1; },
    (v: ReturnType<typeof variant>) => { v.requiresComponents = true; },
    (v: ReturnType<typeof variant>) => { v.product.requiresSellingPlan = true; },
    (v: ReturnType<typeof variant>) => { v.product.isGiftCard = true; },
    (v: ReturnType<typeof variant>) => { v.product.status = "DRAFT"; },
    (v: ReturnType<typeof variant>) => { v.inventoryItem.requiresShipping = false; },
    (v: ReturnType<typeof variant>) => { v.id = "gid://shopify/ProductVariant/999"; },
  ]) { const calls = mock({ variant: mutate }); await assert.rejects(calculateLaunchQuote(await db.brand("brand_1"), credentials, input)); assert.equal(calls.length, 2); }
  mock({ variant: v => { v.sellableOnlineQuantity = 0; v.inventoryPolicy = "CONTINUE"; } });
  assert.equal((await calculateLaunchQuote(await db.brand("brand_1"), credentials, input)).status, "calculated");
}));

test("provider cart changes, fee tampering, warnings, currencies and inconsistent totals fail closed", async () => fixture(async db => {
  const changes: ((d: Draft) => void)[] = [
    d => { d.lineItems[0].quantity = 1; }, d => { d.lineItems[0].components = [{ quantity: 1 }]; },
    d => { d.lineItems.push({ ...d.lineItems[0] }); }, d => { d.lineItems[1].quantity = 2; },
    d => { d.lineItems[1].originalUnitPriceSet = bag(1); }, d => { d.lineItems[1].taxable = false; },
    d => { d.lineItems[1].title = "Unexpected fee"; }, d => { d.totalShippingPriceSet = bag(525); },
    d => { d.totalDiscountsSet = bag(100); }, d => { d.totalPriceSet = bag(1); },
    d => { d.subtotalPriceSet = bag(1); }, d => { d.totalTaxSet.presentmentMoney.currencyCode = "CAD"; },
    d => { d.totalPriceSet.shopMoney = bag(1).shopMoney; }, d => { d.shippingLine.shippingRateHandle = "paid"; },
    d => { d.warnings.push({ errorCode: "WARNING", field: "address", message: "synthetic warning" }); },
  ];
  for (const change of changes) { mock({ draft: change }); await assert.rejects(calculateLaunchQuote(await db.brand("brand_1"), credentials, { ...input, priority: true })); }
  mock({ fail: true }); await assert.rejects(calculateLaunchQuote(await db.brand("brand_1"), credentials, input), /could not be reached/);
}));

test("all five launch destinations use free USD shipping without requesting a shipping handle", async () => fixture(async db => {
  for (const address of [{ countryCode: "US", provinceCode: "OR", zip: "97201" }, { countryCode: "CA", provinceCode: "ON", zip: "M5V 3A8" }, { countryCode: "GB", provinceCode: undefined, zip: "SW1A 1AA" }, { countryCode: "NZ", provinceCode: undefined, zip: "1010" }, { countryCode: "AU", provinceCode: "NSW", zip: "2000" }]) {
    const calls = mock(); await calculateLaunchQuote(await db.brand("brand_1"), credentials, { ...input, shippingAddress: { ...input.shippingAddress, ...address } });
    assert.equal(calls[2].variables.input?.presentmentCurrencyCode, "USD");
    assert.doesNotMatch(calls[2].query, /availableShippingRates/);
  }
}));

test("unverified or foreign brand products and incompatible saved policies never call Shopify", async () => fixture(async db => {
  for (const kind of ["unverified", "foreign", "shipping", "priority", "price"]) {
    const brand = await db.brand("brand_1"); const calls = mock();
    if (kind === "unverified") brand.shopify.status = "not_connected";
    if (kind === "foreign") brand.products = [];
    if (kind === "shipping") brand.shippingPrice = 5;
    if (kind === "priority") brand.checkoutExperience!.priorityEnabled = false;
    if (kind === "price") brand.checkoutExperience!.priorityPrice = 9.99;
    await assert.rejects(calculateLaunchQuote(brand, credentials, { ...input, priority: true })); assert.equal(calls.length, 0);
  }
}));

test("launch API protects admin-only access, rejects settings and credential races, and never enables payments", async () => fixture(async db => {
  const keys = ["NODE_ENV", "APP_URL", "CHECKOUT_ORIGINS", "ADMIN_PASSWORD", "ADMIN_PASSWORD_HASH", "SESSION_SECRET", "CREDENTIAL_ENCRYPTION_KEY"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const globals = globalThis as typeof globalThis & { limitlessStore?: Store }; const previous = globals.limitlessStore; globals.limitlessStore = db;
  const handler = route(handleApi);
  const request = (origin: string, cookie = "") => new Request(`${origin}/api/brands/brand_1/launch-quote`, { method: "POST", headers: { origin, cookie, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { NODE_ENV: "development" });
    assert.equal((await handler(request("http://localhost:3000"))).status, 403);
    Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://admin.example", CHECKOUT_ORIGINS: JSON.stringify({ "https://checkout.example": "aure-studio" }), ADMIN_PASSWORD: "synthetic-test-password", SESSION_SECRET: "s".repeat(48), CREDENTIAL_ENCRYPTION_KEY: "ab".repeat(32) });
    await db.setCredential("brand_1", "shopify", credentials); const cookie = sessionCookie(); const calls = mock();
    assert.equal((await handler(request("https://admin.example"))).status, 401);
    assert.equal((await handler(request("https://checkout.example", cookie))).status, 404);
    const cross = request("https://admin.example", cookie); cross.headers.set("origin", "https://evil.example");
    assert.equal((await handler(cross)).status, 403); assert.equal(calls.length, 0);
    const response = await handler(request("https://admin.example", cookie));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal((await response.json()).paymentReady, false);
    mock({ draft: async () => { const brand = await db.brand("brand_1"); brand.shippingPrice = 10; await db.saveBrand(brand); } });
    assert.equal((await handler(request("https://admin.example", cookie))).status, 409);
    const brand = await db.brand("brand_1"); brand.shippingPrice = 0; await db.saveBrand(brand);
    mock({ draft: async () => { await db.setCredential("brand_1", "shopify", { ...credentials, accessToken: "rotated" }); } });
    assert.equal((await handler(request("https://admin.example", cookie))).status, 409);
    await assert.rejects(db.publish("brand_1", "live"), /Live checkout is not enabled/);
  } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } globals.limitlessStore = previous; }
}));
