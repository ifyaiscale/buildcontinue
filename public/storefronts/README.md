# Storefront asset drop-in guide

These storefronts are intentionally built so final product photography/GIFs can be added without redesigning the pages.

## Cozy Infants
Place under `public/storefronts/cozy-infants/assets/`:
- `hero.gif`
- `peachy.webp`, `raffy.webp`, `katty.webp`, `bluey.webp` (optional replacements for current Shopify product images)
- `whats-in-box.webp`
- `lifestyle-1.gif`

## Chefings
Place under `public/storefronts/chefings/assets/`:
- `hero.gif`
- `green.webp`
- `white.webp`
- `demo-1.gif`
- `closeup.webp`

## FaceJamas
Place under `public/storefronts/facejamas/assets/`:
- `hero.gif`
- `pajamas.webp`
- `blanket-hoodie.webp`
- `pillow.webp`
- `customization.gif`

The missing-asset UI is deliberate: if a file has not been added yet, the page shows the exact filename/slot rather than a broken image.

Checkout uses `public/limitless-storefront-v1.js`, which sends only Shopify variant IDs + quantities. Storefront display totals are never authoritative.
