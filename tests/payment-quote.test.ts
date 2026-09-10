import test from "node:test";
import assert from "node:assert/strict";
import { calculatePaymentQuote, paymentQuoteInput, usdCents } from "../lib/server/payment-quote";
import { Store } from "../lib/server/store";
import { handleApi } from "../lib/server/api";
import { route } from "../lib/server/http";
import { sessionCookie } from "../lib/server/security";

const credentials = { domain: "test.myshopify.com", accessToken: "synthetic-token" };
const variantId = "gid://shopify/ProductVariant/123";
const input = {
  items: [{ productId: "imported-product", quantity: 2 }],
  shippingAddress: { firstName: "Test", lastName: "Buyer", address1: "123 Example Street", city: "Portland", provinceCode: "OR", zip: "97201", countryCode: "US" },
};
const money = (amount: string) => ({ amount, currencyCode: "USD" });
const bag = (amount: string) => ({ shopMoney: money(amount), presentmentMoney: money(amount) });
function calculation(selected = false) {
  return {
    subtotalPriceSet: bag("39.98"), totalShippingPriceSet: bag(selected ? "5.25" : "0"),
    totalTaxSet: bag("3.20"), totalDiscountsSet: bag("0.00"), totalPriceSet: bag(selected ? "48.43" : "43.18"),
    taxesIncluded: false,
    availableShippingRates: [{ handle: "standard-rate", title: "Standard", price: money("5.25") }],
    shippingLine: selected ? { shippingRateHandle: "standard-rate" } : null,
    lineItems: [{ variant: { id: variantId }, quantity: 2, requiresShipping: true, components: [] as { quantity: number }[] }],
    warnings: [] as { errorCode: string; field: string; message: string }[],
  };
}
type Calculation = ReturnType<typeof calculation>;
type Call = { query: string; variables?: { input: Record<string, unknown> } };
function mockProvider(options: { mutate?: (draft: Calculation, selected: boolean) => void; scopes?: string[]; currency?: string; userErrors?: { message: string }[]; fail?: boolean } = {}) {
  const calls: Call[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://test.myshopify.com/admin/api/2026-07/graphql.json");
    assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("X-Shopify-Access-Token"), credentials.accessToken);
    const call: Call = JSON.parse(String(init?.body)); calls.push(call);
    if (call.query.includes("currentAppInstallation")) {
      return Response.json({ data: { shop: { name: "Test", myshopifyDomain: credentials.domain, currencyCode: options.currency ?? "USD" }, currentAppInstallation: { accessScopes: (options.scopes ?? ["read_products", "read_inventory", "write_draft_orders"]).map(handle => ({ handle })) } } });
    }
    assert.match(call.query, /draftOrderCalculate\(input: \$input\)/);
    assert.doesNotMatch(call.query, /draftOrderCreate|draftOrderComplete|orderCreate/);
    if (options.fail) throw new Error("synthetic network failure");
    const selected = !!call.variables?.input.shippingLine;
    const draft = calculation(selected); options.mutate?.(draft, selected);
    return Response.json({ data: { draftOrderCalculate: { calculatedDraftOrder: draft, userErrors: options.userErrors ?? [] } } });
  };
  return calls;
}
async function fixture(fn: (db: Store) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const db = new Store(":memory:");
  const brand = db.brand("brand_1");
  brand.shopify = { status: "verified", account: credentials.domain };
  brand.products = [{ id: "imported-product", variantId, title: "Test variant", description: "Synthetic", available: true, price: 0.01 }];
  db.saveBrand(brand);
  try { await fn(db); } finally { globalThis.fetch = originalFetch; db.db.close(); }
}

test("USD parsing is exact and rejects malformed, negative, sub-cent, and unsafe amounts", () => {
  for (const [value, cents] of [["0", 0], ["0.00", 0], ["0.1", 10], ["19.99", 1999], ["90071992547409.91", Number.MAX_SAFE_INTEGER]] as const) assert.equal(usdCents(value), cents);
  for (const value of ["", "-1", "1.001", "1e2", "Infinity", "NaN", " 1.00", "01.00", "+1", "1.", "90071992547409.92"]) assert.throws(() => usdCents(value), /unsupported USD/);
});

test("preflight accepts only bounded US guest variant requests, not customer prices or unsupported extras", () => {
  assert.deepEqual(paymentQuoteInput.parse(input), input);
  for (const bad of [
    { ...input, total: 1 }, { ...input, shippingPrice: 0 }, { ...input, discountCode: "FREE" },
    { ...input, items: [] }, { ...input, items: [...input.items, ...input.items] },
    { ...input, items: [{ ...input.items[0], quantity: 0 }] },
    { ...input, items: [{ ...input.items[0], quantity: 1.5 }] },
    { ...input, items: [{ ...input.items[0], quantity: 21 }] },
    { ...input, items: [{ ...input.items[0], price: 1 }] },
    { ...input, items: [{ ...input.items[0], customAttributes: [{ key: "photo", value: "private-file" }] }] },
    { ...input, shippingAddress: { ...input.shippingAddress, countryCode: "CA" } },
    { ...input, shippingAddress: { ...input.shippingAddress, provinceCode: "" } },
    { ...input, shippingAddress: { ...input.shippingAddress, zip: "invalid" } },
  ]) assert.equal(paymentQuoteInput.safeParse(bad).success, false);
});

test("preflight discovers Shopify rates and totals without trusting the catalog price or writing data", async () => fixture(async db => {
  const before = db.db.prepare("SELECT total_changes() AS changes").get();
  const calls = mockProvider();
  const result = await calculatePaymentQuote(db.brand("brand_1"), credentials, input);
  assert.equal(result.status, "shipping_selection_required"); assert.equal(result.paymentReady, false); assert.equal(result.mode, "diagnostic");
  assert.equal(result.totals.subtotalCents, 3998); assert.equal(result.totals.taxCents, 320);
  assert.equal(result.selectedShippingRateHandle, null);
  assert.deepEqual(result.shippingRates, [{ handle: "standard-rate", title: "Standard", amountCents: 525 }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].variables?.input, { lineItems: [{ variantId, quantity: 2 }], shippingAddress: input.shippingAddress, presentmentCurrencyCode: "USD", acceptAutomaticDiscounts: false, taxExempt: false });
  assert.deepEqual(db.db.prepare("SELECT total_changes() AS changes").get(), before);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-token|123 Example Street|myshopify/);
}));

test("selected shipping is freshly discovered and applied by handle, never by a custom price", async () => fixture(async db => {
  const calls = mockProvider();
  const result = await calculatePaymentQuote(db.brand("brand_1"), credentials, { ...input, shippingRateHandle: "standard-rate" });
  assert.equal(calls.length, 3); assert.equal(calls[1].variables?.input.shippingLine, undefined);
  assert.deepEqual(calls[2].variables?.input.shippingLine, { shippingRateHandle: "standard-rate" });
  assert.equal(result.status, "calculated"); assert.equal(result.paymentReady, false);
  assert.equal(result.totals.totalCents, 4843); assert.equal(result.totals.shippingCents, 525);
  assert.equal(result.selectedShippingRateHandle, "standard-rate");
}));

test("stale rates and ignored shipping selection cannot produce a calculated result", async () => fixture(async db => {
  const calls = mockProvider();
  await assert.rejects(calculatePaymentQuote(db.brand("brand_1"), credentials, { ...input, shippingRateHandle: "free-forged-rate" }), /no longer available/);
  assert.equal(calls.length, 2);
  mockProvider({ mutate: (draft, selected) => { if (selected) draft.shippingLine = null; } });
  await assert.rejects(calculatePaymentQuote(db.brand("brand_1"), credentials, { ...input, shippingRateHandle: "standard-rate" }), /did not apply/);
}));

test("Shopify warnings and absent shipping rates explicitly block the preflight", async () => fixture(async db => {
  const warning = { errorCode: "MARKET_UNSUPPORTED", field: "marketRegionCountryCode", message: "Market pricing is not supported." };
  const calls = mockProvider({ mutate: draft => { draft.warnings = [warning]; } });
  let result = await calculatePaymentQuote(db.brand("brand_1"), credentials, { ...input, shippingRateHandle: "standard-rate" });
  assert.equal(calls.length, 2); assert.equal(result.status, "blocked"); assert.deepEqual(result.warnings, [warning]);
  assert.deepEqual(result.blockers, ["shopify_warnings"]);
  mockProvider({ mutate: draft => { draft.availableShippingRates = []; } });
  result = await calculatePaymentQuote(db.brand("brand_1"), credentials, input);
  assert.equal(result.status, "blocked"); assert.deepEqual(result.blockers, ["no_shipping_rates"]);
  mockProvider({ mutate: (draft, selected) => { if (selected) draft.warnings = [warning]; } });
  result = await calculatePaymentQuote(db.brand("brand_1"), credentials, { ...input, shippingRateHandle: "standard-rate" });
  assert.equal(result.status, "blocked");
}));

test("explicit zero tax and tax-inclusive provider totals are preserved, never recomputed", async () => fixture(async db => {
  mockProvider({ mutate: draft => { draft.totalTaxSet = bag("0"); draft.totalPriceSet = bag("39.98"); } });
  let result = await calculatePaymentQuote(db.brand("brand_1"), credentials, input);
  assert.equal(result.totals.taxCents, 0); assert.equal(result.totals.totalCents, 3998);
  mockProvider({ mutate: draft => { draft.taxesIncluded = true; draft.totalPriceSet = bag("39.98"); } });
  result = await calculatePaymentQuote(db.brand("brand_1"), credentials, input);
  assert.equal(result.totals.taxesIncluded, true); assert.equal(result.totals.taxCents, 320); assert.equal(result.totals.totalCents, 3998);
}));

test("missing taxes, unsupported currencies and money, and changed cart contents fail closed", async () => fixture(async db => {
  const corruptions: ((draft: Calculation) => void)[] = [
    draft => { Reflect.deleteProperty(draft, "totalTaxSet"); },
    draft => { draft.totalPriceSet.presentmentMoney.currencyCode = "EUR"; },
    draft => { draft.totalPriceSet.presentmentMoney.amount = "1.001"; },
    draft => { draft.totalPriceSet.shopMoney.amount = "1"; },
    draft => { draft.lineItems = []; },
    draft => { draft.lineItems[0].quantity = 1; },
    draft => { draft.lineItems[0].variant.id = "gid://shopify/ProductVariant/456"; },
    draft => { draft.lineItems[0].requiresShipping = false; },
    draft => { Reflect.deleteProperty(draft.lineItems[0], "components"); },
    draft => { draft.availableShippingRates.push(draft.availableShippingRates[0]); },
  ];
  for (const mutate of corruptions) {
    mockProvider({ mutate });
    await assert.rejects(calculatePaymentQuote(db.brand("brand_1"), credentials, input));
  }
}));

test("bundle components fail closed before shipping selection, even with an unchanged parent variant", async () => fixture(async db => {
  const calls = mockProvider({ mutate: draft => { draft.lineItems[0].components = [{ quantity: 2 }]; } });
  await assert.rejects(calculatePaymentQuote(db.brand("brand_1"), credentials, { ...input, shippingRateHandle: "standard-rate" }), /simple physical-product variants only/);
  assert.equal(calls.length, 2);
  mockProvider({ mutate: (draft, selected) => { if (selected) draft.lineItems[0].components = [{ quantity: 2 }]; } });
  await assert.rejects(calculatePaymentQuote(db.brand("brand_1"), credentials, { ...input, shippingRateHandle: "standard-rate" }), /simple physical-product variants only/);
}));

test("demo, unavailable, foreign variants and mismatched account connections never reach Shopify", async () => fixture(async db => {
  const calls = mockProvider();
  for (const kind of ["demo", "unavailable", "foreign", "mismatched", "unverified"]) {
    const brand = db.brand("brand_1");
    if (kind === "demo") delete brand.products[0].variantId;
    if (kind === "unavailable") brand.products[0].available = false;
    if (kind === "foreign") brand.products[0].id = "different-brand-product";
    if (kind === "mismatched") brand.shopify.account = "different.myshopify.com";
    if (kind === "unverified") brand.shopify.status = "not_connected";
    await assert.rejects(calculatePaymentQuote(brand, credentials, input));
  }
  assert.equal(calls.length, 0);
}));

test("draft scope, USD currency, provider errors, and outages are checked without fallback prices", async () => fixture(async db => {
  let calls = mockProvider({ scopes: ["read_products", "read_inventory"] });
  await assert.rejects(calculatePaymentQuote(db.brand("brand_1"), credentials, input), /write_draft_orders/);
  assert.equal(calls.length, 1);
  calls = mockProvider({ currency: "EUR" });
  await assert.rejects(calculatePaymentQuote(db.brand("brand_1"), credentials, input), /USD stores only/);
  assert.equal(calls.length, 1);
  mockProvider({ userErrors: [{ message: "synthetic-private-provider-error" }] });
  await assert.rejects(calculatePaymentQuote(db.brand("brand_1"), credentials, input), /could not calculate/);
  mockProvider({ fail: true });
  await assert.rejects(calculatePaymentQuote(db.brand("brand_1"), credentials, input), /could not be reached/);
}));

test("pricing API requires protected admin origin, rejects demo and credential races, and keeps live gated", async () => fixture(async db => {
  const keys = ["NODE_ENV", "APP_URL", "CHECKOUT_ORIGINS", "ADMIN_PASSWORD", "ADMIN_PASSWORD_HASH", "SESSION_SECRET", "CREDENTIAL_ENCRYPTION_KEY"];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const globals = globalThis as typeof globalThis & { limitlessStore?: Store };
  const previousStore = globals.limitlessStore; globals.limitlessStore = db;
  const handler = route(handleApi);
  const path = "/api/brands/brand_1/payment-quote";
  const request = (origin = "https://admin.example", cookie = "", body = JSON.stringify(input)) => new Request(`${origin}${path}`, { method: "POST", headers: { origin, cookie, "Content-Type": "application/json" }, body });
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { NODE_ENV: "development" });
    assert.equal((await handler(request("http://localhost:3000"))).status, 403);
    Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://admin.example", CHECKOUT_ORIGINS: JSON.stringify({ "https://checkout.example": "aure-studio" }), ADMIN_PASSWORD: "synthetic-test-password", SESSION_SECRET: "s".repeat(48), CREDENTIAL_ENCRYPTION_KEY: "ab".repeat(32) });
    db.setCredential("brand_1", "shopify", credentials);
    const cookie = sessionCookie();
    let calls = mockProvider();
    assert.equal((await handler(request())).status, 401);
    assert.equal((await handler(request("https://checkout.example", cookie))).status, 404);
    const crossSite = request("https://admin.example", cookie); crossSite.headers.set("origin", "https://evil.example");
    assert.equal((await handler(crossSite)).status, 403);
    assert.equal(calls.length, 0);
    const response = await handler(request("https://admin.example", cookie));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).paymentReady, false); assert.equal(calls.length, 2);
    assert.equal((await handler(request("https://admin.example", cookie, "x".repeat(32769)))).status, 413);
    calls = mockProvider({ mutate: () => { db.setCredential("brand_1", "shopify", { ...credentials, accessToken: "rotated-test-token" }); } });
    assert.equal((await handler(request("https://admin.example", cookie))).status, 409);
    assert.equal(calls.length, 2);
    const state = await handler(new Request("https://admin.example/api/state", { headers: { cookie } }));
    assert.equal((await state.json()).environment.liveEnabled, false);
    assert.throws(() => db.publish("brand_1", "live"), /Live checkout is not enabled/);
    assert.equal(db.orders().length, 8);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    globals.limitlessStore = previousStore;
  }
}));
