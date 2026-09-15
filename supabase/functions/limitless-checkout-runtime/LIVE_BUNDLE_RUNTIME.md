# Live bundle runtime note

As of 2026-09-15, Supabase Edge Function `limitless-checkout-runtime` is ACTIVE at version 3 with SHA-256:

`fdcc3a42712792e2539320b24a3b8850b064e45d341febf4e02d127711a2b6ad`

The feature-branch `index.ts` at commit `6fefcc4776572c2ee2894dbc0d2abbabfaa36475` contains the readable bundle implementation but includes one superseded GraphQL selection: `discountNode{id}` in `platformDiscounts` and the corresponding node-ID comparison.

The live v3 compatibility patch intentionally removes that field/comparison because the existing Limitless Shopify app scopes do not include `read_discounts`. No additional Shopify permission was added.

Live v3 instead validates the automatic bundle discount using the data available from `draftOrderCalculate` under the current least-privilege scopes:

- exactly one platform discount for an eligible bundle;
- `automaticDiscount=true`;
- `bxgyDiscount=false`;
- no discount code;
- discount class exactly `PRODUCT`;
- `presentationLevel=line_level`;
- exact expected tier title (`Limitless Duo/Trio/Family ...`);
- platform discount amount equals Shopify `totalDiscounts`;
- total discount equals the exact mathematically expected 10% / 15% / 20% line-level amount.

No-charge runtime QA passed after this live v3 patch:

- CHEFINGS Duo: subtotal 5800, discount 580, shipping 0, total 5220.
- COZYINFANTS Family + Priority: subtotal 19600, discount 3920, priority 499, shipping 0, total 16179.
- FACEJAMAS Trio: three separate quantity-1 Pajamas lines with unique Personalization IDs, subtotal 20700, discount 3105, shipping 0, total 17595.
- `paymentEnabled=false` for all tests.
- both acceptance and public payment gates remained false.

Before merging `feature/bundles-launch` to production, sync `index.ts` to the live v3 least-privilege form (remove `discountNode{id}` and the node-ID comparison) so Git becomes byte-for-byte authoritative again. Do not broaden Shopify permissions to solve this difference.
