# Limitless Checkout — current handoff

Last updated: 2026-09-13. This is the current operational checkpoint. Use Git history and the linked architecture docs for older implementation history; superseded screenshots/notes are not current evidence.

## Current state

Production branch: `hoplite/beroia-65b17429`.

Merged foundation:
- PR #1 / `e0be107d…`: encrypted storefront cart handoff into Limitless Checkout.
- PR #2 / `589edeb…`: shopper cart → authoritative Shopify quote → fail-closed Whop payment start → encrypted return receipt → durable payment/Shopify-order confirmation.

Active PR #3: **Gate live checkout behind controlled acceptance** on `chatgpt/controlled-live-activation`.

Customer charging remains OFF. No real Whop payment has been performed. Netlify production deploys are paused by the team credit allowance; deploy previews remain available. The owner plans to upgrade after the build work is complete.

## Shopper payment flow now implemented

1. Storefront sends only Shopify variant IDs + quantities to the existing cart-start contract.
2. Limitless normalizes against the synced brand catalog and creates a short-lived encrypted brand-bound cart token.
3. Checkout collects email/delivery data and requests `POST /api/checkout/:slug/quote`.
4. Shopify is authoritative for current variant availability/inventory, merchandise, tax and total. Standard shipping is free; optional priority processing is $4.99 once/order.
5. Any address/priority edit invalidates the reviewed quote.
6. Shopper payment requires both `PAYMENT_ACCEPTANCE_ENABLED=true` and `PUBLIC_PAYMENT_ENABLED=true`, plus a live brand with verified providers.
7. Immediately before payment side effects, Shopify is recalculated again. The fresh cent total must exactly match the buyer-reviewed `confirmedTotalCents`; otherwise payment stops before a payment attempt, Shopify draft or Whop checkout is created.
8. Limitless creates/reuses one immutable payment attempt, one tagged Shopify draft and one exact-value one-time Whop checkout.
9. Signed Whop success notifications are deduplicated and independently reverified by company, currency, exact cents, checkout ID and Limitless attempt metadata.
10. The worker completes only the bound Shopify draft. Duplicate successful payments enter review instead of fulfilling twice.
11. Whop returns to an encrypted receipt URL. Buyer status is derived from the durable ledger: awaiting payment, processing, confirmed, review or expired. **Confirmed** is shown only after the Shopify order is completed.

No card numbers are collected by Limitless; Whop hosts payment collection.

## Controlled live activation — PR #3

Live publishing is no longer intended to depend on a single environment toggle. PR #3 adds a two-key activation model:

- `GET /api/brands/:id/launch-readiness` reports launch checks.
- `POST /api/brands/:id/launch-acceptance` records a completed controlled acceptance attempt.
- Publishing `{mode:"live"}` uses the controlled activation path instead of the legacy hard block.

A brand can become `status=live` + `mode=live` only when all of these are true:
- administrator payment acceptance gate enabled;
- public payment gate enabled;
- storefront domain configured;
- current Shopify credential matches a verified Shopify connection;
- current Whop credential matches a verified Whop connection;
- Whop webhook secret is configured;
- at least one available imported Shopify variant exists;
- launch shipping policy is still free standard shipping + $4.99 priority;
- a controlled acceptance payment attempt is in `completed` state with its Shopify order recorded.

The acceptance record is stored in the existing private metadata table; no schema migration is required. It is bound to the completed attempt/order, provider accounts, total, and a fingerprint of launch-critical brand state. Product/catalog, storefront-domain, provider-account, shipping-policy or priority-price changes invalidate acceptance and require another controlled acceptance purchase before live activation.

Direct `Store.publish(..., "live")` remains blocked, so internal callers cannot bypass the launch-readiness gate. Demo publishing remains available as an immediate non-payment fallback.

## Current real brand/provider state — supersedes old connection notes

Fresh Supabase read on 2026-09-13:

| Brand | Status/mode | Shopify | Whop | Synced variants |
| --- | --- | --- | --- | ---: |
| CHEFINGS | draft / demo | verified | verified | 2 |
| COZYINFANTS | draft / demo | verified | verified | 5 |
| FACEJAMAS | draft / demo | verified | verified | 3 |

Do not repeat old instructions claiming COZYINFANTS still needs Whop connection or CHEFINGS/FACEJAMAS have zero products. Provider connection verification is still not equivalent to a successful payment/webhook acceptance run.

## Fixed launch policy

- First acceptance brand: COZYINFANTS.
- Launch countries: US, Canada, UK (`GB`), New Zealand, Australia.
- Currency: USD throughout quote/payment verification.
- Standard shipping: free.
- Priority processing: optional, unchecked by default, $4.99 USD once/order.
- Browser-provided product prices, shipping prices, tax and totals are never authoritative.

## Storefront source boundary

CHEFINGS / COZYINFANTS / FACEJAMAS storefront source remains in separate Sites-managed projects not exposed through the current GitHub connector. Their existing Checkout buttons still need to call the already-documented form POST in `docs/CART_STOREFRONT_HANDOFF.md` when that source becomes accessible. Do not invent a second cart protocol.

FACEJAMAS additionally requires durable private artwork/photo storage and a fulfillment-safe personalization reference before that brand can launch. Do not place raw/base64 customer artwork in cart tokens or public URLs.

## Deployment / verification

- PR #2 final Netlify deploy preview succeeded at commit `027aed87…`; it included the reviewed-total lock and shopper routes.
- PR #3 Netlify deploy preview succeeded at commit `ae12d69…`, including physical Next.js routes for launch readiness/acceptance and the existing payment worker functions.
- Netlify production remains on an older deploy because production deploys are paused by exhausted team credits. Do not claim merged code is live until production reports the matching commit ready.
- The repository's Netlify build command validates the production Next.js build. Do not describe that as the full Node test suite unless the test runner was separately executed.

## Next actions — ordered

1. Merge PR #3 after its final status remains green. Keep `PUBLIC_PAYMENT_ENABLED` off.
2. When storefront source is accessible, wire COZYINFANTS Checkout to the existing cart handoff; then CHEFINGS/FACEJAMAS.
3. After Netlify upgrade, production-deploy the verified branch and confirm exact commit/function deployment. Upgrading hosting does not enable payments.
4. Exercise COZYINFANTS cart → delivery → authoritative Shopify quote with customer payment still locked.
5. Verify COZYINFANTS payment-specific Whop readiness, especially the saved webhook secret/callback delivery. Never request secrets in chat.
6. On explicit owner authorization, run one controlled acceptance purchase using the administrator acceptance path. Verify signed callback, independent Whop lookup, exactly one Shopify order, worker recovery and return status.
7. Record that completed attempt through launch acceptance. Only then enable the public gate and activate COZYINFANTS live. Repeat acceptance for other brands.
8. Validate cancel/failure/retry/duplicate payment behavior, paid-but-unsynced visibility, refunds/disputes, alerts and backups before broad traffic.

## Definition of done

A real customer can start at a brand storefront, pass a server-authenticated cart into Limitless, review an authoritative Shopify-calculated USD total, pay exactly that amount through Whop, and receive confirmation only after exactly one corresponding paid Shopify order exists with the required fulfillment details. Retries, duplicate notifications and paid-but-delayed synchronization must never create duplicate orders or tell a paid customer to pay again.

See `docs/PAYMENT_ARCHITECTURE.md`, `docs/PAYMENT_IMPLEMENTATION_PLAN.md`, `docs/CART_STOREFRONT_HANDOFF.md`, and Git history for detail.
