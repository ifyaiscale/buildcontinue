# Limitless Checkout — current handoff

Last updated: 2026-09-15.

## Safety state

- Production branch: `hoplite/beroia-65b17429`.
- Current feature branch: `feature/bundles-launch`.
- Customer charging remains **OFF**.
- Supabase runtime config `production` currently has `payment_acceptance_enabled=false` and `public_payment_enabled=false`.
- Do not arm controlled acceptance until the owner explicitly authorizes the real acceptance purchase immediately before it happens.
- Do not enable public payments until controlled acceptance succeeds and the owner separately authorizes public charging.
- All three brands remain `draft/demo` until controlled acceptance is complete.

## Hosting / Netlify

Netlify team is currently paused because the Personal plan's 1,000 monthly credits were exhausted by automated production deployments, not customer traffic.

Observed usage:

- 67 production deploys = 1,005 credits;
- web requests = 1.6 credits;
- compute = 4 credits;
- bandwidth = 0.5 credits;
- total = 1,011.1 credits.

Development must no longer happen by repeatedly committing to the production-deploy branch. Bundle work is isolated on `feature/bundles-launch`. Batch changes and make one production release when hosting is restored.

## Provider recovery — complete

All six provider connections are recovered and verified in `public.limitless_provider_credentials_v2`.

| Brand | Shopify | Whop | Support |
| --- | --- | --- | --- |
| CHEFINGS | `5ctqsk-tn.myshopify.com` | `biz_oSecL7MrGnjRmk` | `support@chefings.com` |
| COZYINFANTS | `1b1zsq-0y.myshopify.com` | `biz_ZfAubYoFlaajTC` | `support@cozyinfants.com` |
| FACEJAMAS | `f0m103-zz.myshopify.com` | `biz_MW3bKLHdo3ItcR` | `support@facejamas.com` |

No provider secret, webhook secret, access token, client secret, service-role key or private crypto material belongs in Git/browser responses.

## Active backend architecture

- `limitless-admin-auth-v2` — admin authentication.
- `limitless-admin-state` — dashboard state.
- `limitless-shopify-admin` / `limitless-whop-admin` — provider recovery.
- `limitless-launch-admin` v2 — policy/readiness/acceptance/live activation.
- `limitless-checkout-runtime` — cart/view/quote/status/payment-start runtime.
- `limitless-acceptance-checkout` — browser-scoped controlled acceptance lane.
- `limitless-payment-reconciler` — internal Whop verification + Shopify completion.
- `limitless-whop-webhook` v5 — signed Whop receiver.

Key migrations:

- `008_checkout_runtime_v3.sql`
- `009_launch_admin_v3.sql`
- `010_lock_bootstrap_runtime_role.sql`
- `011_fix_launch_policy_commit_validation.sql`

The obsolete runtime-role bootstrap RPC was locked down after the Supabase advisor flagged browser execution. Remaining RLS/no-policy notices are intentional deny-by-default private-table notices.

## Payment / reconciliation invariants

1. Shopify is authoritative for availability, bundle discount, shipping, tax and exact USD total.
2. Limitless creates a transaction-locked/idempotent payment attempt.
3. Shopify creates one reserved draft tagged with the Limitless attempt ID.
4. Whop creates one one-time checkout configuration for the exact cents and carries `limitless_attempt_id` metadata.
5. Card/wallet fields remain embedded through Whop; raw card/CVV never enters Limitless.
6. A real `payment.succeeded` requires a valid Whop signature and correct brand account.
7. Reconciler independently retrieves the Whop payment and verifies company, amount, currency, checkout config and Limitless metadata.
8. Exactly one Shopify draft completes into a paid order under lease/idempotency protection.
9. Duplicate/retried webhooks cannot create another order.
10. Customer confirmation is based on persisted attempt state, not browser redirect alone.

## Customer policy v2 — approved

Owner approved policy v2 for CHEFINGS, COZYINFANTS and FACEJAMAS on 2026-09-15. The original Launch Center clicks exposed a small validation bug in `limitless_launch_policy_commit`; it was fixed and all three explicit approvals were persisted with the current policy hashes.

Core policy:

- USD checkout;
- US, Canada, UK, New Zealand, Australia;
- free standard shipping;
- optional $4.99 priority processing once/order, unchecked by default;
- priority processing is not expedited carrier service and does not guarantee delivery;
- Shopify calculates authoritative tax and total;
- Whop hosts card entry;
- CHEFINGS/COZYINFANTS eligible non-personalized return requests within 30 days;
- FACEJAMAS personalized items final sale except damage, defect, incorrect item or verified production error;
- FACEJAMAS source artwork remains private and fulfillment uses opaque `Personalization ID` references.

Policy approval is not real-charge authorization.

## Bundle feature — backend complete and no-charge tested

Canonical bundle documentation: `docs/BUNDLES.md`.

Shared launch tiers:

| Tier | Quantity | Shopify automatic product discount |
| --- | ---: | ---: |
| Solo / Buy 1 | 1 | 0% |
| Duo / Buy 2 | 2 | 10% |
| Trio / Buy 3 | 3 | 15% |
| Family / Buy 4+ | 4+ | 20% |

Shopify automatic discounts were created for all three stores. The overlapping rules were verified to choose only the best eligible tier and not stack.

### CHEFINGS

- $29 product.
- Duo: $58.00 → **$52.20**.
- Trio: $87.00 → **$73.95**.
- Family: $116.00 → **$92.80**.
- Limitless runtime no-charge QA independently reproduced the Duo result: subtotal 5800, discount 580, shipping 0, total 5220, `paymentEnabled=false`.

### COZYINFANTS

- $49 Cuddle Bears product.
- Duo: $98.00 → **$88.20**.
- Trio: $147.00 → **$124.95**.
- Family: $196.00 → **$156.80**.
- Priority Processing Shopify product is intentionally excluded from bundle discount scope.
- Limitless runtime no-charge QA verified Family + $4.99 priority = **$161.79**, shipping 0, `paymentEnabled=false`.

### FACEJAMAS

Eligible products: Pajamas, Pillows and Blanket Hoodies. Different eligible product types count together toward the bundle tier.

- Pajamas Duo: **$124.20**.
- Pajamas Trio: **$175.95**.
- Pajamas Family: **$220.80**.
- Mixed Pajamas + Pillow + Blanket Hoodie received the Trio 15% tier in Shopify calculation.
- Limitless runtime no-charge QA verified the hard case: three separate quantity-1 Pajamas lines, each with a different valid Personalization ID, subtotal $207.00, discount $31.05, total **$175.95**, shipping 0, `paymentEnabled=false`.
- Disposable QA personalization rows were deleted afterward (`leftover=0`).

`limitless-checkout-runtime` is live as bundle-aware runtime `v3-bundles` / Edge Function version 3. It uses `acceptAutomaticDiscounts=true`, disables discount codes, and validates the exact automatic PRODUCT/line-level tier title plus the exact mathematically expected 10/15/20% amount. This preserves least-privilege Shopify permissions; `read_discounts` was not added.

Both payment gates were rechecked after bundle QA and remain false.

## Bundle storefront code

On `feature/bundles-launch`:

- `public/limitless-storefront-v1.js` v1.2.0 supports normal quantities plus FaceJamas repeated quantity-1 personalized lines with unique refs/proofs.
- `public/limitless-bundles-v1.js` renders the product-page bundle cards, per-item price, savings and best-value badge.
- CHEFINGS/COZYINFANTS labels: Buy 1 / Buy 2 / Buy 3 / Buy 4.
- FACEJAMAS labels: Solo / Duo / Trio / Family Pack.

Important: the bundle cards are **not yet mounted on the live storefront product pages**. The storefronts are ChatGPT Sites projects whose `dist/index.html`, `dist/style.css` and `dist/app.js` source is not exposed through the currently available connector/GitHub repos. Do not recreate or replace those sites. Once storefront source access is available, integration is a small script include + selector mount + use selected quantity in the existing Add to Cart/Buy path.

## FaceJamas personalization / fulfillment

Artwork does not need to appear in checkout.

- Source image stays private in Supabase.
- Public handoff uses opaque `pers_…` reference + proof.
- Shopify line metadata receives `Personalization ID` only.
- Fulfillment can export Shopify orders and resolve the ID through private tooling/API or authenticated short-lived signed artwork URLs.
- Ordered artwork retention: 90 days for fulfillment/replacement support, then source-file deletion; non-image audit/order metadata may remain.

For Duo/Trio/Family, each personalized item is a separate quantity-1 line with its own unique Personalization ID. This allows couples/friends/families to use different faces even when all items are the same Shopify variant.

## Private controlled acceptance — implemented, not armed

The owner can run a real acceptance purchase without exposing payments to ordinary customers:

1. Launch Center issues a 20-minute encrypted acceptance session only when acceptance gate is ON and public gate is OFF.
2. Only the browser holding that Secure/HttpOnly cookie routes quote/payment-start through `limitless-acceptance-checkout`.
3. Ordinary shoppers remain on the public runtime with payment disabled.
4. Post-payment confirmation exposes the immutable `attempt_…` reference for recording acceptance.

The acceptance service reuses the authoritative runtime quote, so bundle pricing flows into the same draft/payment path.

## Remaining work before public launch

1. Restore Netlify hosting/credits and keep future development off production deploys.
2. Mount the already-built bundle selector into the real CHEFINGS/COZYINFANTS/FACEJAMAS product-page source once that source is accessible.
3. Make one batched production release containing the storefront/bundle integration rather than many small production deploys.
4. With both customer gates still OFF, run final browser no-charge smoke QA on the restored hosted checkout.
5. Immediately before a real charge, obtain explicit owner authorization for controlled acceptance.
6. Set only `payment_acceptance_enabled=true`; keep `public_payment_enabled=false`.
7. Run controlled real purchases and verify exact discounted Shopify total → Whop → signed webhook → independent lookup → exactly one paid Shopify order; verify retries do not duplicate.
8. For FaceJamas, confirm the paid Shopify order contains each expected `Personalization ID` and private fulfillment resolution works.
9. Record acceptance and activate accepted brands to `live/live` while public charging can still remain OFF.
10. Obtain a separate explicit owner authorization before setting `public_payment_enabled=true`.

## Definition of done

A customer can select a product/bundle on the correct storefront, pass only trusted variant/quantity/personalization references into Limitless, review Shopify's authoritative discounted USD total with free standard shipping and optional $4.99 priority processing, pay that exact amount in embedded Whop fields, and receive confirmation only after exactly one corresponding paid Shopify order exists. FaceJamas orders contain opaque Personalization IDs that private fulfillment tooling can resolve to the correct source artwork. Retries and duplicate notifications never create duplicate orders or ask a paid customer to pay again.
