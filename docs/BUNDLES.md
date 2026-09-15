# Limitless launch bundles

Last updated: 2026-09-15.

## Offer structure

Bundle pricing is Shopify-authoritative. Product pages may display the offer and savings, but they must send only real Shopify variants/quantities (plus FaceJamas personalization references) into Limitless. The Limitless runtime independently asks Shopify to calculate the actual discount and total.

Launch tiers for all three brands:

| Tier | Quantity | Automatic product discount |
| --- | ---: | ---: |
| Solo / Buy 1 | 1 | 0% |
| Duo / Buy 2 | 2 | 10% |
| Trio / Buy 3 | 3 | 15% |
| Family / Buy 4+ | 4+ | 20% |

Shopify automatic discounts are deliberately overlapping. Shopify selects the best eligible tier and does not stack them. Discount codes remain disabled in Limitless checkout.

## Storefront presentation

`public/limitless-bundles-v1.js` contains the shared product-page selector UI.

CHEFINGS and COZYINFANTS use utility labels: `Buy 1`, `Buy 2`, `Buy 3`, `Buy 4`.

FACEJAMAS uses:

- **Solo** — Just for you.
- **Duo** — Couples or best friends.
- **Trio** — Friends, siblings, or a trio.
- **Family Pack** — Families and groups.

The selector displays total price, per-item price, savings, and the best-value badge. These display calculations are not trusted for checkout. Shopify recalculates the authoritative amount server-side.

## Shopify rules

### CHEFINGS

Eligible product: Shopify product `gid://shopify/Product/8283943370821`.

Automatic discount nodes:

- Duo: `gid://shopify/DiscountAutomaticNode/1331055329349`
- Trio: `gid://shopify/DiscountAutomaticNode/1331055362117`
- Family: `gid://shopify/DiscountAutomaticNode/1331055394885`

Verified against the $29 Chefings variant:

- 2 × $29 = $58 → **$52.20**
- 3 × $29 = $87 → **$73.95**
- 4 × $29 = $116 → **$92.80**

### COZYINFANTS

Eligible product: Cuddle Bears `gid://shopify/Product/9206000910510`.

Automatic discount nodes:

- Duo: `gid://shopify/DiscountAutomaticNode/1487671296174`
- Trio: `gid://shopify/DiscountAutomaticNode/1487671328942`
- Family: `gid://shopify/DiscountAutomaticNode/1487671361710`

The separate Priority Processing Shopify product is intentionally not eligible for bundle discounts. Limitless owns priority processing as a once-per-order $4.99 checkout option.

Verified against a $49 Cuddle Bear:

- 2 × $49 = $98 → **$88.20**
- 3 × $49 = $147 → **$124.95**
- 4 × $49 = $196 → **$156.80**

Limitless also verified a Family bundle plus $4.99 priority processing: **$161.79**, with free standard shipping and payments still disabled.

### FACEJAMAS

Eligible products:

- Pajamas `gid://shopify/Product/9605383028949`
- Pillows `gid://shopify/Product/9605383061717`
- Blanket Hoodies `gid://shopify/Product/9605383094485`

Automatic discount nodes:

- Duo: `gid://shopify/DiscountAutomaticNode/1475042115797`
- Trio: `gid://shopify/DiscountAutomaticNode/1475042148565`
- Family: `gid://shopify/DiscountAutomaticNode/1475042181333`

Eligible FaceJamas items count together across products. A test containing one Pajamas + one Pillows + one Blanket Hoodies item received the Trio 15% discount.

Pajamas-only verification at $69 each:

- 2 items: **$124.20**
- 3 items: **$175.95**
- 4 items: **$220.80**

## FaceJamas personalization bundles

A FaceJamas bundle can contain different people. Do not represent a personalized Duo/Trio/Family selection as one Shopify line with quantity 2/3/4 because that would give the whole quantity one personalization reference.

Instead, every personalized item is a separate quantity-1 cart line with its own verified `Personalization ID`. Repeated use of the same Shopify variant is allowed only for FaceJamas when every repeated line:

- has quantity 1;
- has a unique verified personalization reference/proof;
- is still unclaimed, unexpired, and not already bound to another order.

No source image is sent into Shopify. Shopify receives only `Personalization ID` line attributes.

A no-charge runtime QA used three separate Personalization IDs on three quantity-1 lines of the same Pajamas variant. Limitless accepted the cart, Shopify calculated the Trio tier, and the authoritative result was $207.00 subtotal, $31.05 discount, $175.95 total, $0 shipping. The disposable QA personalization rows were deleted afterward.

## Checkout validation

The bundle-aware `limitless-checkout-runtime` uses `acceptAutomaticDiscounts=true` and `allowDiscountCodesInCheckout=false`.

For a bundle-eligible cart it requires exactly one Shopify platform discount and verifies:

- it is an automatic product discount;
- it is not BXGY and has no entered code;
- discount class is PRODUCT;
- presentation level is line-level;
- title exactly matches the expected Duo/Trio/Family launch tier;
- Shopify's discount amount equals the mathematically expected 10%, 15%, or 20% amount;
- Shopify's calculated total equals merchandise subtotal minus the verified discount, plus optional $4.99 priority processing and authoritative tax;
- free standard shipping remains $0.

The Limitless Shopify apps do not need `read_discounts`. The Draft Order calculation provides enough information to validate the active automatic discount while preserving least-privilege Shopify scopes.

## Deployment state

Bundle code is being developed on `feature/bundles-launch` to avoid consuming Netlify production-deploy credits for development commits.

The Supabase checkout runtime has already been updated and no-charge tested with both payment gates OFF. The customer-facing product-page selector module is ready in Git, but it still must be mounted into the actual storefront product-page source before customers can see it.

Do not merge/publish the feature branch merely to test visual changes while the Netlify team is paused. Batch the storefront integration and release it in one production deployment after hosting is restored.
