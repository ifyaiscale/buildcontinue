# Storefront → Limitless cart handoff

Updated: 2026-09-13

This is the integration contract for CHEFINGS (`chefings`), COZYINFANTS (`cozyinfants`) and FACEJAMAS (`facejamas`).

## What the storefront sends

The browser sends **only Shopify variant IDs and quantities**. It must never send a trusted price, subtotal, tax, shipping amount, Whop identifier, Shopify credential or payment credential.

```json
{
  "items": [
    { "variantId": "48885625847982", "quantity": 2 }
  ]
}
```

Both Shopify numeric variant IDs and Admin GraphQL IDs (`gid://shopify/ProductVariant/...`) are accepted. Limitless resolves them against the brand's currently imported catalog and stores the canonical imported product ID inside a short-lived encrypted cart token.

## Browser handoff

Use a normal HTML form POST. This intentionally performs a browser navigation instead of a cross-origin `fetch`, so the storefront does not need CORS access to checkout internals.

```js
function openLimitlessCheckout({ checkoutOrigin, brandSlug, items }) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${checkoutOrigin}/cart/start/${brandSlug}`;

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "cart";
  input.value = JSON.stringify({
    items: items.map(({ variantId, quantity }) => ({
      variantId: String(variantId),
      quantity: Number(quantity),
    })),
  });

  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}
```

Example call for COZYINFANTS:

```js
openLimitlessCheckout({
  checkoutOrigin: "https://<current-limitless-checkout-origin>",
  brandSlug: "cozyinfants",
  items: bag.map(item => ({ variantId: item.shopifyVariantId, quantity: item.quantity })),
});
```

The POST is accepted only when the browser `Origin` hostname matches the brand's configured storefront domain or one of its configured storefront aliases. Production storefront traffic must use HTTPS.

## What Limitless does

1. Loads the requested brand server-side.
2. Confirms each variant exists in that brand and is currently available.
3. Converts numeric Shopify IDs to the canonical imported GraphQL variant ID.
4. Rejects duplicate aliases of the same variant and invalid quantities.
5. Encrypts brand ID, slug, canonical items, quantities, issue time and expiry using the server credential-encryption key.
6. Redirects with HTTP 303 to `/checkout/<slug>?cart=<encrypted-token>`.
7. The checkout server decrypts and revalidates the cart before rendering.
8. The checkout UI calculates its display total from the current Limitless catalog; order creation independently revalidates product IDs/prices again.

Cart tokens expire after 30 minutes and cannot be moved between brands or modified without failing authenticated decryption.

## Current launch limitation

This shipment connects the **storefront cart to Limitless Checkout**. It does not remove the existing public-payment gate. The cart-aware checkout currently exercises the existing demo-order path so cart preservation can be verified without charging a customer. The next payment shipment must connect this cart context to the existing server-owned launch quote → Shopify draft → Whop payment → verified payment → exactly-once Shopify completion lifecycle.

FACEJAMAS image/personalization assets are deliberately **not** placed in this token yet. That brand still needs durable upload/storage and a fulfillment-safe personalization reference before launch.
