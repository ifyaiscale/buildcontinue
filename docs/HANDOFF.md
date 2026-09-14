# Limitless Checkout — current handoff

Last updated: 2026-09-13. This file is the current operational checkpoint. Use Git history and the linked architecture documents for older implementation history; do not treat superseded notes or screenshots as current evidence.

## Current shipment — storefront cart → exact quote → gated payment → confirmation

Active PR: **#2 — Connect customer checkout to payment lifecycle** on branch `chatgpt/customer-payment-flow`.

The shopper-facing bridge now connects the encrypted storefront cart handoff to the payment architecture that was already implemented. The cart-aware checkout no longer creates a synthetic demo order. It now collects delivery details, requests an authoritative Shopify launch quote, shows the exact Shopify-calculated USD merchandise/tax/priority total, and invalidates that quote whenever delivery or priority changes.

Three shopper API routes were added under the brand checkout boundary:

- `POST /api/checkout/:slug/quote` — decrypts and revalidates the brand-bound cart token, rechecks current Shopify inventory/catalog state, and calculates the free-standard-shipping / optional $4.99 priority / tax total through Shopify.
- `POST /api/checkout/:slug/payment-start` — remains fail-closed. It can call the existing durable payment engine only when **both** `PAYMENT_ACCEPTANCE_ENABLED=true` and `PUBLIC_PAYMENT_ENABLED=true`, and only for a brand already published in live mode with verified Whop. It creates no browser-trusted prices or product lines.
- `GET /api/checkout/:slug/status?receipt=...` — resolves an encrypted brand-bound customer receipt to the original idempotent payment attempt and reports only safe states: awaiting payment, processing, confirmed, review, or expired.

The Whop return page polls the durable ledger. It says **Payment confirmed** only after the attempt is in the completed state, meaning the verified payment has produced the bound Shopify order. A paid-but-not-yet-completed attempt says processing and explicitly tells the buyer not to pay again. Review/error states also fail safely instead of inviting another payment.

Customer payment activation is deliberately separate from the existing administrator acceptance gate. `PUBLIC_PAYMENT_ENABLED` is currently unset/off; this shipment does **not** enable a real customer charge. No real Whop payment has been performed.

### Verification for this shipment

- Netlify deploy preview #2 successfully built commit `4255898095c9b029cda9a1ba58d03ec112e189a7` with the new Next.js customer quote/payment/confirmation routes and the existing scheduled payment worker.
- A follow-up regression commit adds checkout-host isolation coverage for the new quote/payment/status endpoints and keeps admin and cross-brand paths blocked. Its exact final preview status must be checked before merging PR #2.
- New tests cover the independent public-payment gate, strict rejection of browser-injected products/prices/totals/payment IDs, encrypted receipt tamper/cross-brand rejection, idempotent attempt lookup, and expiry mapping.
- No production deploy is currently possible because the Netlify team exhausted its production-deploy credit allowance. Published production remains online on its previous deploy; branch/deploy previews remain available. The owner plans to upgrade after building.

## Current production account/catalog state — supersedes older connection notes

A fresh read-only Supabase check on 2026-09-13 confirmed all three real brands exist once, remain `draft` + `demo`, and now have **verified Shopify + verified Whop connections with synced product catalogs**:

| Brand | Shopify | Whop | Synced variants |
| --- | --- | --- | ---: |
| CHEFINGS | verified | verified | 2 |
| COZYINFANTS | verified | verified | 5 |
| FACEJAMAS | verified | verified | 3 |

Do not repeat older handoff instructions saying COZYINFANTS still needs Whop connection or that CHEFINGS/FACEJAMAS have zero products. Provider verification is not the same as completed payment acceptance; webhook-secret/payment-specific behavior still needs acceptance verification before customer activation.

## Storefront cart handoff — merged foundation

PR #1 was merged to production branch `hoplite/beroia-65b17429` at commit `e0be107d1bdc2e2e72d887221b295461f13f1306`.

Implemented behavior:

- Static storefront sends only Shopify variant IDs + quantities.
- Limitless accepts numeric Shopify variant IDs and canonical `gid://shopify/ProductVariant/...` IDs and normalizes them against the synced brand catalog.
- Browser prices/subtotals are never authoritative.
- Server produces a short-lived encrypted, tamper-resistant, brand-bound cart token.
- Cart start is restricted to the configured storefront domain/aliases.
- Checkout revalidates the token and current catalog before using it.
- Storefront integration contract is in `docs/CART_STOREFRONT_HANDOFF.md`.

The separate CHEFINGS / COZYINFANTS / FACEJAMAS storefront source still lives in Sites-managed projects that are not exposed through the current GitHub connector. Their existing Checkout buttons therefore still need to be wired to the documented form POST when that source becomes available. Do not invent a second cart contract.

## Payment engine already implemented

The customer bridge must continue to reuse, not replace, the existing payment engine:

1. Shopify launch pricing revalidates current variants, availability/inventory, destination, free standard shipping, optional unchecked $4.99 priority processing once per order, and exact USD taxes/total.
2. `PaymentAttempts` persists an immutable attempt before provider side effects, with encrypted customer/quote context and account/cart/total bindings.
3. Shopify creates/reserves one tagged draft for that exact attempt. Uncertain creation is recovered by its unique tag rather than creating a replacement.
4. Whop creates one exact-value one-time USD checkout with immutable `limitless_attempt_id` metadata.
5. Signed Whop `payment.succeeded` deliveries are recorded/deduplicated and enqueue durable payment jobs.
6. The worker independently retrieves the payment and checks company, currency, exact cents, checkout ID and attempt metadata.
7. A verified payment can complete only its original Shopify draft. Completion uses a lease and retry/recovery logic; duplicate successful payments enter review rather than fulfilling twice.
8. Buyer-facing confirmation must remain derived from this durable state, never from Whop browser redirect parameters alone.

No card number is collected by Limitless; Whop hosts payment collection.

## Fixed launch policy

- Launch destinations: US, Canada, UK (`GB`), New Zealand, Australia.
- Currency: USD throughout storefront display, quote, Whop payment and recorded payment checks.
- Standard shipping: **free**; product prices already include standard shipping economics.
- Optional priority processing: **$4.99 USD**, unchecked by default, once per order.
- No browser-provided shipping price, product price, tax or total is trusted.
- COZYINFANTS remains the first end-to-end acceptance brand; reuse the accepted flow for CHEFINGS and FACEJAMAS.

## Deployment state

- GitHub production branch: `hoplite/beroia-65b17429`.
- Netlify project: existing `limitlesscheckout` project; do not create a replacement project.
- Supabase: existing Limitless Checkout project; do not create a replacement database.
- Netlify production deploys are currently paused by the team's credit allowance. Production site remains online on the older deploy. Deploy previews are the active build/verification path until the owner upgrades or the billing cycle resets.
- Do not claim merged code is live until Netlify production reports the matching commit as ready.

## Remaining launch work — ordered

1. **Finish PR #2 verification and merge.** Confirm the follow-up Netlify deploy preview is green after the route-isolation regression and this handoff update. Keep `PUBLIC_PAYMENT_ENABLED` off.
2. **Wire the real storefront Checkout buttons** for CHEFINGS / COZYINFANTS / FACEJAMAS to the existing cart-start contract when their Sites-managed source is accessible. Start with COZYINFANTS.
3. **Exercise COZYINFANTS quote flow against real Shopify** through an accessible checkout preview: cart → delivery details → exact Shopify total. Verify representative destination/tax behavior without starting payment.
4. **Verify payment-specific Whop readiness** for COZYINFANTS, including saved webhook secret/callback delivery and exact one-time checkout creation requirements. Never request secrets in chat.
5. **Controlled acceptance flow.** When the owner explicitly authorizes a real acceptance purchase, enable only the necessary acceptance/public gates, run one controlled COZYINFANTS purchase, verify signed callback + independent Whop lookup + exactly one paid Shopify order + buyer confirmation, then test failure/cancel/retry/duplicate behavior. Disable/fail closed if any binding differs.
6. **Production publish after Netlify upgrade.** Deploy the verified production branch, confirm the exact commit and callbacks, then deliberately publish/activate shopper payment only after acceptance. Do not equate upgrading Netlify with enabling payments.
7. **FACEJAMAS personalization before that brand launches.** Artwork/photo data needs durable private storage and a fulfillment-safe reference carried into the Shopify order. Do not place raw/base64 customer artwork in cart tokens or public URLs.
8. Add/verify refund/dispute/reconciliation visibility, paid-but-unsynced operations, alerts and restore-tested backups before broad traffic.

## Definition of done

A real customer can start at a brand storefront, choose the correct products/options, pass a server-authenticated cart into Limitless, receive an authoritative Shopify-calculated USD total, pay exactly that amount through Whop, return to a status page that does not trust browser success, and receive confirmation only after **exactly one** corresponding paid Shopify order exists with the required fulfillment details. Provider duplicate/retry/failure paths must not create duplicate orders or tell a paid customer to pay again.

For design rationale and provider references, continue with `docs/PAYMENT_ARCHITECTURE.md`, `docs/PAYMENT_IMPLEMENTATION_PLAN.md`, `docs/CART_STOREFRONT_HANDOFF.md`, and Git history.
