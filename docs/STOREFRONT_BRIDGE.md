# Storefront bridge v1

`public/limitless-storefront-v1.js` is the browser-side adapter for the existing CHEFINGS, COZYINFANTS and FACEJAMAS storefronts. It does **not** calculate authoritative prices, call Shopify Admin, call Whop, or contain credentials. It sends Shopify variant IDs, quantities, and—only for FaceJamas—verified personalization references into the server-owned cart handoff.

The shared bundle UI lives in `public/limitless-bundles-v1.js`. Bundle display math is convenience only; Shopify calculates the real automatic discount and final total server-side.

When the storefront source is available, load both scripts:

```html
<script src="https://limitlesscheckout.netlify.app/limitless-bundles-v1.js" defer></script>
<script src="https://limitlesscheckout.netlify.app/limitless-storefront-v1.js" defer></script>
```

Normal checkout handoff:

```js
LimitlessCheckout.start({
  brandSlug: "cozyinfants",
  items: bag.map((item) => ({
    variantId: item.shopifyVariantId,
    quantity: item.quantity,
  })),
});
```

The server independently validates storefront origin, catalog mapping, availability, inventory, bundle discount, personalization proof, shipping policy and Shopify-calculated total.

## Launch bundle selector

The shared launch tiers are:

| Selector | Quantity | Shopify automatic discount |
| --- | ---: | ---: |
| Solo / Buy 1 | 1 | 0% |
| Duo / Buy 2 | 2 | 10% |
| Trio / Buy 3 | 3 | 15% |
| Family Pack / Buy 4 | 4+ | 20% |

For CHEFINGS and COZYINFANTS the product page should present utility labels (`Buy 1`, `Buy 2`, `Buy 3`, `Buy 4`).

For FACEJAMAS the product page should present:

- **Solo** — Just for you
- **Duo** — Couples or best friends
- **Trio** — Friends, siblings or a trio
- **Family Pack** — Families and groups

Example mount:

```js
const bundles = LimitlessBundles.render({
  root: "#bundle-options",
  brandSlug: "cozyinfants",
  unitPrice: 49,
  selected: "solo",
  onChange: (offer) => {
    selectedQuantity = offer.quantity;
  },
});
```

Do not pass the UI's displayed bundle total into checkout. Pass the actual quantity; Shopify/Limitless will independently calculate the discount and final price.

Full pricing/verification details are in `docs/BUNDLES.md`.

## Current Shopify variant mapping

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

COZYINFANTS also has a Shopify Priority Processing product. **Never put that product in the storefront bag.** Limitless owns priority processing as the optional once-per-order $4.99 checkout option, and that product is intentionally excluded from bundle discount scope.

## COZYINFANTS adapter

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

## FACEJAMAS adapter

FaceJamas private durable upload/proof validation is implemented. Shopify receives only an opaque `Personalization ID`; the source image stays private.

For **Solo**, a single item is a single quantity-1 cart line:

```js
{
  variantId: "54933535916245",
  quantity: 1,
  personalizationRef: upload.ref,
  personalizationProof: upload.proof,
}
```

For **Duo / Trio / Family**, do **not** use one personalized line with quantity 2/3/4. Each person/item needs its own quantity-1 line and its own upload:

```js
const items = people.map((person) => ({
  variantId: selectedVariantId,
  quantity: 1,
  personalizationRef: person.upload.ref,
  personalizationProof: person.upload.proof,
}));

LimitlessCheckout.start({
  brandSlug: "facejamas",
  items,
});
```

The same Shopify variant may therefore appear multiple times for FaceJamas only when each repeated line has quantity 1 and a different verified personalization reference. Regular duplicate variants remain rejected.

This was no-charge tested with three Pajamas lines using three unique Personalization IDs: Shopify applied the Trio 15% discount and calculated $207.00 → $175.95 while the raw artwork stayed private.

## Why this is hosted by Limitless

Keeping the adapter and selector with the checkout backend prevents the storefronts from duplicating security/pricing logic. A storefront may display title, image, unit price, savings and selection state, but the server remains authoritative for real cart identity and money.

## Current source-access boundary

The existing storefronts are ChatGPT Sites projects with static `dist/index.html`, `dist/style.css` and `dist/app.js` source in Sites-managed Git. This chat does not currently have a Sites source connector or a GitHub repo containing those storefront source trees.

Therefore the shared selector and handoff modules are ready, but the bundle cards are **not yet visible on the live product pages**. Once storefront source access is available, the remaining product-page work is a small integration: add the script includes, mount the selector near the purchase controls, and make the existing Add to Cart/Buy action use the selected quantity (or unique personalized quantity-1 lines for FaceJamas).

Do not recreate or replace the storefront designs just to add bundles.
