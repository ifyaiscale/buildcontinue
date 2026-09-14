# Storefront bridge v1

`public/limitless-storefront-v1.js` is the small browser-side adapter for the existing static CHEFINGS, COZYINFANTS and FACEJAMAS Sites storefronts. It does **not** calculate prices, call Shopify Admin, call Whop, or contain credentials. It sends only Shopify variant IDs and quantities into the server-owned cart handoff.

After the current Limitless production branch is deployable, static storefronts can load:

```html
<script src="https://limitlesscheckout.netlify.app/limitless-storefront-v1.js" defer></script>
```

Then their existing Checkout button can call:

```js
LimitlessCheckout.start({
  brandSlug: "cozyinfants",
  items: bag.map((item) => ({
    variantId: item.shopifyVariantId,
    quantity: item.quantity,
  })),
});
```

The bridge validates 1–30 lines, Shopify numeric or Admin GraphQL variant IDs, integer quantities from 1–20, and duplicate variants. It constructs a normal hidden HTML form and navigates to `/cart/start/<brand>`. The browser therefore supplies the real storefront `Origin`, which the Limitless server independently checks against that brand's configured storefront domain/aliases. Browser-side validation is convenience only; the server remains authoritative.

The bridge deliberately drops every other cart property. A storefront object may contain display price, title, image, options or UI state, but only `variantId`/`shopifyVariantId` and `quantity` are serialized.

## Current Shopify variant mapping

These IDs were rechecked against the currently synced Limitless catalogs on 2026-09-13. Re-sync/revalidate before launch if the Shopify catalogs change.

| Brand | Storefront choice | Shopify variant ID |
| --- | --- | --- |
| CHEFINGS | Green | `45748183531589` |
| CHEFINGS | White | `45748183564357` |
| COZYINFANTS | Peachy | `48885625847982` |
| COZYINFANTS | Raffy | `48885625880750` |
| COZYINFANTS | Katty | `48885625913518` |
| COZYINFANTS | Bluey | `48885625946286` |
| FACEJAMAS | Blanket Hoodies | `54933536014549` |
| FACEJAMAS | Pajamas | `54933535916245` |
| FACEJAMAS | Pillows | `54933535981781` |

COZYINFANTS' Shopify catalog also contains a priority-processing variant. **Do not put it in the storefront bag.** Limitless owns priority processing as the optional once-per-order $4.99 checkout option.

## COZYINFANTS adapter

If the existing bag stores a companion name instead of a Shopify ID, use the local display-to-ID mapping at the boundary:

```js
const cozyVariantIds = {
  Peachy: "48885625847982",
  Raffy: "48885625880750",
  Katty: "48885625913518",
  Bluey: "48885625946286",
};

function startCozyCheckout() {
  LimitlessCheckout.start({
    brandSlug: "cozyinfants",
    items: bag.map((item) => ({
      variantId: cozyVariantIds[item.name],
      quantity: item.quantity,
    })),
  });
}
```

Do not copy the displayed `$49` into this call. Shopify/Limitless reprice the cart server-side.

## CHEFINGS adapter

```js
const chefingsVariantIds = {
  Green: "45748183531589",
  White: "45748183564357",
};

function startChefingsCheckout() {
  LimitlessCheckout.start({
    brandSlug: "chefings",
    items: bag.map((item) => ({
      variantId: chefingsVariantIds[item.color],
      quantity: item.quantity,
    })),
  });
}
```

The exact property names (`item.name`, `item.color`, etc.) must be matched to the existing Sites `app.js` when source access is recovered; do not rewrite the storefront to fit these examples.

## FACEJAMAS adapter — not launch-ready yet

The Shopify product variants are mapped above, but the current prototype keeps uploaded customer photos only in the browser and bag entries do not contain a durable fulfillment asset reference. Do **not** enable FaceJamas Checkout merely by adding the bridge. First implement private durable image upload, validation/access controls, and a fulfillment-safe personalization reference that is carried into the Shopify order.

## Why this is hosted by Limitless

Keeping this tiny adapter with the checkout backend means the three static storefronts do not need to duplicate cart-security logic. The server still rejects unauthorized origins, stale/unknown variants, unavailable products and tampered cart sessions. Updating this file never grants a storefront additional backend authority.

## Current source-access boundary

The existing storefronts are ChatGPT Sites projects with static `dist/index.html`, `dist/style.css` and `dist/app.js` source in Sites-managed Git. The current chat can read the saved Site projection but cannot materialize or write the Sites source tree, and no Sites source connector is exposed here. Do not recreate those projects or overwrite their designs from the text projection. When source access is available, the remaining integration should be a small `app.js` edit plus the script include above.
