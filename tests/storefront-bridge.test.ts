import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function bridge() {
  const submitted: Array<Record<string, unknown>> = [];
  const body = { appendChild(node: Record<string, unknown>) { submitted.push(node); } };
  const document = {
    body,
    createElement(tag: string) {
      if (tag === "form") return {
        children: [] as Array<Record<string, unknown>>,
        style: {} as Record<string, string>,
        appendChild(node: Record<string, unknown>) { this.children.push(node); },
        submit() { (this as Record<string, unknown>).submitted = true; },
      };
      if (tag === "input") return {};
      throw new Error(`unexpected tag ${tag}`);
    },
  };
  const window = { document } as Record<string, unknown>;
  const source = readFileSync("public/limitless-storefront-v1.js", "utf8");
  vm.runInNewContext(source, { window, document, URL, encodeURIComponent, Object, Array, Number, String, Error, globalThis: window });
  return { api: window.LimitlessCheckout as { version: string; normalizeItems(items: unknown): Array<{ variantId: string; quantity: number }>; payload(items: unknown): string; start(options: unknown): void }, submitted };
}

test("storefront bridge serializes only Shopify variant ID and quantity", () => {
  const { api } = bridge();
  assert.equal(api.version, "1.0.0");
  assert.deepEqual(JSON.parse(JSON.stringify(api.normalizeItems([
    { shopifyVariantId: 48885625847982, quantity: "2", price: 0.01, title: "browser-only display" },
    { variantId: "gid://shopify/ProductVariant/48885625880750", quantity: 1, paymentId: "pay_fake" },
  ]))), [
    { variantId: "48885625847982", quantity: 2 },
    { variantId: "gid://shopify/ProductVariant/48885625880750", quantity: 1 },
  ]);
  const payload = api.payload([{ variantId: "48885625847982", quantity: 1, total: 1 }]);
  assert.deepEqual(JSON.parse(payload), { items: [{ variantId: "48885625847982", quantity: 1 }] });
  assert.equal(payload.includes("total"), false);
});

test("storefront bridge rejects invalid and duplicate cart lines", () => {
  const { api } = bridge();
  for (const items of [
    [],
    [{ variantId: "not-shopify", quantity: 1 }],
    [{ variantId: "48885625847982", quantity: 0 }],
    [{ variantId: "48885625847982", quantity: 1.5 }],
    [{ variantId: "48885625847982", quantity: 21 }],
    [{ variantId: "48885625847982", quantity: 1 }, { variantId: "gid://shopify/ProductVariant/48885625847982", quantity: 2 }],
  ]) assert.throws(() => api.normalizeItems(items));
});

test("storefront bridge submits a hidden POST form to the brand cart-start endpoint", () => {
  const { api, submitted } = bridge();
  api.start({ brandSlug: "cozyinfants", items: [{ variantId: "48885625847982", quantity: 2 }] });
  assert.equal(submitted.length, 1);
  const form = submitted[0] as { method: string; action: string; style: Record<string, string>; children: Array<{ type: string; name: string; value: string }>; submitted: boolean };
  assert.equal(form.method, "POST");
  assert.equal(form.action, "https://limitlesscheckout.netlify.app/cart/start/cozyinfants");
  assert.equal(form.style.display, "none");
  assert.equal(form.submitted, true);
  assert.equal(form.children.length, 1);
  assert.equal(form.children[0].type, "hidden");
  assert.equal(form.children[0].name, "cart");
  assert.deepEqual(JSON.parse(form.children[0].value), { items: [{ variantId: "48885625847982", quantity: 2 }] });
});

test("storefront bridge rejects unsafe checkout origins and invalid brand slugs", () => {
  const { api } = bridge();
  const cart = [{ variantId: "48885625847982", quantity: 1 }];
  assert.throws(() => api.start({ brandSlug: "../admin", items: cart }), /brandSlug/);
  assert.throws(() => api.start({ brandSlug: "cozyinfants", items: cart, checkoutOrigin: "http://evil.example" }), /HTTPS/);
  assert.throws(() => api.start({ brandSlug: "cozyinfants", items: cart, checkoutOrigin: "https://example.com/path" }), /origin only/);
});
