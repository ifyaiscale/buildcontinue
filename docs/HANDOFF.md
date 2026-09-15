# Limitless Checkout — current handoff

Last updated: 2026-09-15.

## Safety state

- Production branch: `hoplite/beroia-65b17429`.
- Customer charging remains **OFF**.
- Supabase runtime config `production` currently has `payment_acceptance_enabled=false` and `public_payment_enabled=false`.
- Do not arm controlled acceptance until the owner explicitly authorizes the real acceptance purchase immediately before it happens.
- Do not enable public payments until controlled acceptance succeeds and the owner separately authorizes public charging.

## Provider recovery — COMPLETE FOR ALL THREE BRANDS

All six live provider credentials are securely stored in `public.limitless_provider_credentials_v2` using the server-side AES-256-GCM provider key.

### CHEFINGS

- Brand: `brand_570bb818-40e1-43c5-b34e-9c8bfbf82f9e`
- Shopify: `5ctqsk-tn.myshopify.com` — recovered/verified.
- Whop: `biz_oSecL7MrGnjRmk` — recovered/verified.
- Support: `support@chefings.com`.

### COZYINFANTS

- Brand: `brand_b014e3c8-06b4-4834-b4a7-772dadf8a607`
- Shopify: `1b1zsq-0y.myshopify.com` — recovered/verified.
- Whop: `biz_ZfAubYoFlaajTC` — recovered/verified.
- Support: `support@cozyinfants.com`.

### FACEJAMAS

- Brand: `brand_dd7799da-caef-4abc-8ee0-1a161e59a2c6`
- Shopify: `f0m103-zz.myshopify.com` — recovered/verified.
- Whop: `biz_MW3bKLHdo3ItcR` — recovered/verified.
- Support: `support@facejamas.com`.

Brand metadata has been normalized so all six provider references report `status=verified` and match the encrypted v2 credentials.

No Shopify client secret/access token, Whop API key, webhook secret or provider AES key belongs in Git or browser responses.

## Admin recovery architecture

Fresh Netlify deploys lost reliable access to the original Netlify runtime secrets (`DATABASE_URL`, old admin/session secrets and old provider encryption key). The legacy `limitless.credentials` ciphertext is therefore not a valid runtime dependency.

Current admin path:

- authentication: Supabase Edge Function `limitless-admin-auth-v2`;
- state read: Supabase Edge Function `limitless-admin-state`;
- provider recovery: `limitless-shopify-admin` / `limitless-whop-admin`;
- launch administration: Supabase Edge Function `limitless-launch-admin` v2 through the Next.js Launch Center routes.

Launch Center support, policy, readiness, controlled-acceptance recording and live activation routes no longer depend on the lost Netlify database/encryption secrets.

Do not restore the old Netlify-secret dependency.

## Checkout runtime v3 — MIGRATED AND NO-CHARGE QA PASSED

Supabase migration `20260915191615_checkout_runtime_v3` installs transaction-locked checkout/payment primitives around the existing private Limitless tables.

Active Supabase services:

- `limitless-checkout-runtime` — public cart/view/quote/status runtime; normal payment start remains gated.
- `limitless-payment-reconciler` — internal service-role-only Whop verification and Shopify completion.
- `limitless-whop-webhook` v5 — signed webhook receiver that invokes the reconciler for real Limitless payments.
- `limitless-launch-admin` v2 — admin policy/readiness/acceptance/live-activation service.
- `limitless-acceptance-checkout` v1 — separate browser-scoped controlled-acceptance service; it is not a public-payment bypass.

Source tracking:

- `supabase/functions/limitless-checkout-runtime/index.ts`
- `supabase/functions/limitless-payment-reconciler/index.ts`
- `supabase/functions/limitless-whop-webhook/index.ts`
- `supabase/functions/limitless-launch-admin/index.ts`
- `supabase/functions/limitless-acceptance-checkout/index.ts`
- `migrations/008_checkout_runtime_v3.sql`
- `migrations/009_launch_admin_v3.sql`
- `migrations/010_lock_bootstrap_runtime_role.sql`
- `migrations/011_fix_launch_policy_commit_validation.sql`

The old bootstrap role RPC was locked down after the Supabase security advisor identified that it was executable by browser roles. Anonymous/authenticated/service-role execution was revoked; the remaining advisor entries are informational RLS-with-no-policy notices for intentionally private deny-by-default tables.

## Verified Netlify deployment

Latest verified production application deploy containing the private acceptance route/UI wiring and source tracking:

- deploy `6aa9a4e67d96de0009537bd9`
- state `ready`
- commit `f3683c33a50fe5cdaf4011f165fd72c403b627a7`
- Next.js plugin/build success
- secret scan: zero matches
- branch `hoplite/beroia-65b17429`

Later commits `7771fb890cf596b8633d04fb0cb04c89c44d242d`, `a803342f6e74aa929417c95f9478f6a95d121182`, and `6ca6c6fae3887883ae6576096b7c2a64eaea9c65` add tracked SQL migration files/documentation; they do not weaken payment gates.

## Payment and reconciliation behavior

The v3 payment design preserves these safety invariants:

1. Shopify calculates authoritative product availability, free standard shipping, destination tax and exact USD total.
2. A transaction-locked Limitless payment attempt is created with an idempotency key.
3. Shopify creates one reserved draft order tagged with the Limitless attempt ID.
4. Whop creates one one-time checkout configuration for the exact cents and carries `limitless_attempt_id` metadata.
5. Whop card/wallet fields remain embedded in the branded checkout; raw card/CVV data never passes through Limitless.
6. `payment.succeeded` must have a valid Whop signature and correct brand account.
7. The internal reconciler independently retrieves the Whop payment and verifies company, amount, currency, checkout configuration and Limitless attempt metadata.
8. Exactly one Shopify draft is completed into the paid order under a completion lease/idempotency guard.
9. Duplicate/retried webhooks must not create another Shopify order.
10. Customer confirmation is based on persisted payment-attempt state, not merely a browser redirect.

Public customer charging remains disabled until controlled acceptance passes.

## Whop webhook state

All three dedicated Whop `payment.succeeded` endpoints previously passed signed dashboard synthetic tests. Synthetic events prove signature transport only and are never payable.

The receiver is now `limitless-whop-webhook` v5. A real event with both payment ID and `limitless_attempt_id` is passed to the internal reconciler; a synthetic dashboard event remains non-payable.

## Private controlled-acceptance lane — IMPLEMENTED, NOT ARMED

Controlled real acceptance can be tested without exposing payment fields to ordinary customers:

1. Authenticated Launch Center calls `/api/brands/[id]/acceptance-session`.
2. `limitless-launch-admin` issues a 20-minute encrypted acceptance token only when the private acceptance gate is ON, public payment is OFF, and launch prerequisites are current.
3. The browser opens `https://checkout.<brand>.com/acceptance/<slug>?token=...`.
4. The checkout host validates the token, sets a Secure/HttpOnly/SameSite=Lax brand acceptance cookie, then returns the owner to the storefront.
5. The owner shops normally. Only the browser holding that cookie routes quote/payment-start through `limitless-acceptance-checkout`.
6. Ordinary customer traffic continues through `limitless-checkout-runtime`, where payment remains disabled while `public_payment_enabled=false`.
7. The controlled payment-start response is bound to an immutable `attempt_...` ID; the checkout stores that reference in an HttpOnly cookie and shows it on the post-payment confirmation page for Launch Center recording.

Current gates are both false, so this private lane cannot create a Whop checkout yet.

## No-charge authoritative Shopify QA — PASSED 2026-09-15

QA called the active Supabase checkout runtime and Shopify Admin calculation APIs only. No Shopify draft order, Whop checkout configuration or payment attempt was created.

Sample destination used for calculation: Toronto, Ontario, Canada. Shopify returned zero tax for the sample address on these stores; that reflects current Shopify tax configuration and Shopify remains authoritative.

### CHEFINGS

Test variant: `gid://shopify/ProductVariant/45748183531589`.

- cart handoff: HTTP 200, encrypted v3 cart generated;
- standard quote: USD $29.00 subtotal, $0 shipping, $0 discount, $29.00 total;
- priority quote: exactly +$4.99 once/order, $0 shipping, $33.99 total;
- payment remained disabled.

### COZYINFANTS

Test variant: `gid://shopify/ProductVariant/48885625847982`.

- cart handoff: HTTP 200, encrypted v3 cart generated;
- standard quote: USD $49.00 subtotal, $0 shipping, $0 discount, $49.00 total;
- priority quote: exactly +$4.99 once/order, $0 shipping, $53.99 total;
- payment remained disabled.

### FACEJAMAS

Test variant: `gid://shopify/ProductVariant/54933535916245`.

A disposable QA personalization receipt was created only to exercise proof validation and was deleted immediately after the quote checks. No actual source image or payment attempt was created.

- cart handoff: HTTP 200, encrypted v3 cart generated;
- Shopify line item contained only `Personalization ID = pers_...`; no source image/private path entered the Shopify calculation or payment data;
- standard quote: USD $69.00 subtotal, $0 shipping, $0 discount, $69.00 total;
- priority quote: exactly +$4.99 once/order, $0 shipping, $73.99 total;
- payment remained disabled;
- disposable QA personalization row cleanup verified (`leftover=0`);
- controlled QA payment-attempt count remained zero.

## FaceJamas personalization / fulfillment architecture

**Do not treat customer artwork display inside checkout as a launch requirement. It is not needed.**

Current architecture:

- Customer uploads a source image to private Supabase storage before checkout.
- The public handoff uses an opaque `pers_…` reference plus proof; raw image bytes/private storage paths never enter a public cart/payment URL.
- After proof validation, the encrypted cart carries only the opaque personalization reference.
- Shopify draft/order line metadata receives **`Personalization ID`**.
- The customer source image stays private; it is not copied to Shopify public media or embedded into Limitless payment UI.
- The personalization reference is associated with one payment attempt and then the resulting Shopify order.
- Fulfillment can export Shopify orders containing `Personalization ID` and resolve that reference through private tooling/API.
- A shipping/production agent can alternatively use an authenticated endpoint that returns order context plus a short-lived signed artwork URL.
- Ordered source artwork retention: 90 days after order association for fulfillment/replacement support, then private source-file deletion; non-image order/audit metadata may remain.

“Artwork binding” therefore means **order-to-artwork association**, not checkout-page image embedding.

## Customer launch policy v2 — APPROVED FOR ALL THREE BRANDS

Canonical policy text is in `docs/STORE_LAUNCH_POLICIES.md` and `lib/server/launch-policies.ts`; `limitless-launch-admin` v2 uses the same wording.

Shared policy:

- USD checkout;
- US, Canada, UK, New Zealand, Australia;
- free standard shipping;
- optional $4.99 priority processing once/order, unchecked by default;
- priority processing is not an expedited carrier service and does not guarantee delivery;
- Shopify calculates authoritative taxes and total;
- Whop hosts payment-card entry; raw payment-card data is not collected by the storefront/Limitless.

CHEFINGS / COZYINFANTS:

- eligible non-personalized returns requested within 30 days of delivery;
- items unused/original condition;
- damaged, defective or incorrect orders reviewed for replacement/correction/refund;
- cancellations accepted before fulfillment/production but not guaranteed after processing starts;
- priority-processing fee non-refundable after priority processing begins.

FACEJAMAS:

- personalized items final sale except damaged, defective, incorrect or verified production-error cases;
- qualifying issues may be replaced/corrected/refunded;
- cancellation accepted before production but not guaranteed once production begins;
- customer must have rights to uploaded image;
- normal print placement/color variation may occur unless an explicit production proof is provided;
- Shopify stores an opaque Personalization ID while fulfillment retrieves private artwork through authenticated/time-limited tooling.

Owner approved policy v2 for CHEFINGS, COZYINFANTS and FACEJAMAS on 2026-09-15. The initial Launch Center approval clicks exposed a validation bug in `limitless_launch_policy_commit`; the RPC was corrected (`OR` validation instead of accidental string concatenation), and all three explicit owner approvals were then persisted with their current policy-v2 hashes. This approval is **not** authorization for a real charge or for public payment enablement.

## Storefront / launch configuration

Storefronts:

- `chefings.com`
- `cozyinfants.com`
- `facejamas.com`

Branded checkout origins:

- `checkout.chefings.com`
- `checkout.cozyinfants.com`
- `checkout.facejamas.com`

Launch configuration:

- currency: USD;
- countries: US, Canada, UK, New Zealand, Australia;
- standard shipping: free;
- priority processing: $4.99 once/order, unchecked by default.

All three brands remain `draft/demo` until launch acceptance is complete.

## Remaining work before public launch — ordered

1. Confirm current Launch Center readiness shows providers/catalog/shipping/policy ready while both payment gates remain OFF.
2. Immediately before a real charge, obtain explicit owner authorization for one controlled real acceptance purchase.
3. Only then set `payment_acceptance_enabled=true` while keeping `public_payment_enabled=false`.
4. Use the Launch Center **Start private acceptance checkout** action for CHEFINGS first and complete one real purchase in the browser-only 20-minute acceptance session.
5. Verify exact Whop payment → signed callback → independent Whop lookup → one Shopify order → confirmed customer state; retry/duplicate delivery must not create a second order.
6. Record the shown immutable `attempt_...` ID in Launch Center.
7. Run a FaceJamas acceptance purchase if required for personalized-order fulfillment verification; confirm Shopify has `Personalization ID` and private fulfillment resolution works. No checkout image embedding is required.
8. Activate the accepted brand to `live/live` while public payment can still remain OFF.
9. Ask for separate explicit owner authorization before setting `public_payment_enabled=true` for customers.

## Definition of done

A customer can start from the correct Shopify storefront, pass a server-authenticated cart to the matching branded Limitless checkout, review an authoritative Shopify-calculated USD total, pay that exact amount through embedded Whop fields, and receive confirmation only after exactly one corresponding Shopify order exists with all required fulfillment metadata. FaceJamas Shopify orders include an opaque `Personalization ID` that authorized fulfillment tooling can resolve to the correct private source artwork. Retries and duplicate notifications never create duplicate orders or ask a paid customer to pay again.
