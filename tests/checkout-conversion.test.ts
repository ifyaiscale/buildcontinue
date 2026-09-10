import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../lib/server/store";
import { checkoutExperience, checkoutTotals } from "../lib/checkout";
import { checkoutInput } from "../lib/server/validation";

const customer = { email: "conversion-test@example.com", firstName: "Test", lastName: "Customer", address: "1 Example Street", city: "Portland", postalCode: "97201", country: "US" };
const baseOrder = { mode: "demo", items: [{ productId: "product_1", quantity: 1 }], customer };

test("old brands receive safe conversion defaults without overwriting brand identity", () => {
  const db = new Store(":memory:");
  try {
    const brand = db.brand("brand_1");
    const content = checkoutExperience(brand);
    assert.equal(content.showReview, true);
    assert.equal(content.reviewConfirmed, false);
    assert.equal(content.returnsText, "");
    assert.equal(content.discountCode, "");
    assert.equal(content.allowTips, false);
    assert.equal(content.priorityEnabled, false);
    assert.equal(content.offerEndsAt, "");
    assert.equal(brand.accent, "#3c5143");
    assert.equal(brand.checkoutExperience, undefined);
  } finally { db.db.close(); }
});

test("conversion content persists independently per brand and rejects unsupported claims/fields", () => {
  const db = new Store(":memory:");
  try {
    const original = db.brand("brand_1");
    const content = { ...checkoutExperience(original), returnsText: "Contact us within 14 days for returns.", reviewQuote: "Easy to use.", reviewAuthor: "Sample reviewer", reviewConfirmed: false, discountCode: "SAVE10", discountPercent: 10 };
    db.updateBrand(original.id, { checkoutExperience: content });
    assert.deepEqual(db.brand(original.id).checkoutExperience, content);
    assert.equal(db.brand(original.id).accent, original.accent);
    assert.equal(db.brand("brand_2").checkoutExperience, undefined);
    assert.throws(() => db.updateBrand(original.id, { checkoutExperience: { ...content, reviewRating: 6 } }));
    assert.throws(() => db.updateBrand(original.id, { checkoutExperience: { ...content, reviewConfirmed: true, reviewQuote: "" } }));
    assert.throws(() => db.updateBrand(original.id, { checkoutExperience: { ...content, discountPercent: 100 } }));
    assert.throws(() => db.updateBrand(original.id, { checkoutExperience: { ...content, showPaymentMethods: "yes" } }));
    assert.throws(() => db.updateBrand(original.id, { checkoutExperience: { ...content, verifiedBuyer: true } }));
    assert.throws(() => db.updateBrand(original.id, { checkoutExperience: { ...content, bumpProductId: "product_2" } }), /available product/);
    assert.throws(() => db.updateBrand(original.id, { checkoutExperience: { ...content, offerEndsAt: "2099-01-01T00:00:00Z", offerText: "" } }));
    assert.throws(() => db.updateBrand(original.id, { checkoutExperience: { ...content, offerEndsAt: "2099-01-01T00:00:00Z", offerText: "Limited offer", discountCode: "", discountPercent: 0 } }));
  } finally { db.db.close(); }
});

test("server totals include discount, priority, tips, and real bump items without trusting client amounts", () => {
  const db = new Store(":memory:");
  try {
    const brand = db.addTestProduct("brand_1", { title: "Travel pouch", description: "Test accessory", price: 12.5 });
    const bump = brand.products[1];
    db.updateBrand(brand.id, { checkoutExperience: { ...checkoutExperience(brand), discountCode: "SAVE10", discountPercent: 10, priorityEnabled: true, priorityPrice: 4.99, allowTips: true, bumpProductId: bump.id } });
    const payload = { ...baseOrder, items: [{ productId: "product_1", quantity: 1 }, { productId: bump.id, quantity: 1 }], options: { discountCode: "save10", tipPercent: 10, priority: true } };
    const result = db.checkout(brand.slug, payload, true, "conversion-order-1");
    const saved = db.orders().find(order => order.id === result.orderId)!;
    assert.deepEqual(saved.breakdown, { subtotal: 60.5, discount: 6.05, shipping: 5, priority: 4.99, tip: 5.45, total: 69.89 });
    assert.equal(result.total, 69.89);
    assert.equal(saved.items.length, 2);
    assert.deepEqual(db.checkout(brand.slug, payload, true, "conversion-order-1"), result);
    assert.equal(db.orders().length, 9);
    assert.throws(() => db.checkout(brand.slug, { ...payload, options: { ...payload.options, tipPercent: 15 } }, true, "conversion-order-1"), /different order/);
    assert.throws(() => checkoutInput.parse({ ...payload, options: { ...payload.options, discountAmount: 500 } }));
    assert.throws(() => checkoutInput.parse({ ...payload, options: { ...payload.options, tipPercent: -10 } }));
    assert.throws(() => db.checkout(brand.slug, { ...payload, options: { discountCode: "WRONG" } }, true), /not valid/);
  } finally { db.db.close(); }
});

test("shipping threshold uses discounted subtotal and extras are never preselected", () => {
  const db = new Store(":memory:");
  try {
    let brand = db.brand("brand_1");
    brand = db.updateBrand(brand.id, { freeShippingThreshold: 90, checkoutExperience: { ...checkoutExperience(brand), discountCode: "TEN", discountPercent: 10, allowTips: true, priorityEnabled: true } });
    const items = [{ price: 48, quantity: 2 }];
    assert.deepEqual(checkoutTotals(brand, items), { subtotal: 96, discount: 0, shipping: 0, priority: 0, tip: 0, total: 96 });
    assert.deepEqual(checkoutTotals(brand, items, { discountCode: "TEN" }), { subtotal: 96, discount: 9.6, shipping: 5, priority: 0, tip: 0, total: 91.4 });
    const other = db.brand("brand_2");
    assert.throws(() => checkoutTotals(other, [{ price: 64, quantity: 1 }], { priority: true }), /not available/);
    assert.throws(() => checkoutTotals(other, [{ price: 64, quantity: 1 }], { tipPercent: 10 }), /not available/);
  } finally { db.db.close(); }
});

test("discount deadlines expire server-side and cannot be reset by client input", () => {
  const db = new Store(":memory:");
  try {
    let brand = db.brand("brand_1");
    brand = db.updateBrand(brand.id, { checkoutExperience: { ...checkoutExperience(brand), discountCode: "TIMED", discountPercent: 15, offerEndsAt: "2026-01-01T00:00:00Z", offerText: "15% off with TIMED" } });
    assert.equal(checkoutTotals(brand, [{ price: 48, quantity: 1 }], { discountCode: "TIMED" }, Date.parse("2025-12-31T23:59:59Z")).discount, 7.2);
    assert.throws(() => checkoutTotals(brand, [{ price: 48, quantity: 1 }], { discountCode: "TIMED" }, Date.parse("2026-01-01T00:00:00Z")), /expired/);
    assert.throws(() => db.checkout(brand.slug, { ...baseOrder, options: { discountCode: "TIMED" } }, true), /expired/);
    assert.throws(() => checkoutInput.parse({ ...baseOrder, options: { offerEndsAt: "2099-01-01T00:00:00Z", discountCode: "TIMED" } }));
    assert.equal(db.checkout(brand.slug, baseOrder, true).total, 53);
  } finally { db.db.close(); }
});
