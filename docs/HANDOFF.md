# Limitless Checkout — current handoff

Last updated: 2026-09-15.

## Safety state

- Production branch: `hoplite/beroia-65b17429`.
- Customer charging remains **OFF**.
- Supabase checkout runtime gates are still disabled for public charging.
- Do not perform a real charge until the owner explicitly authorizes the controlled acceptance purchase immediately before it happens.
- Do not enable public payments merely because providers, webhooks or checkout UI are connected.

## Provider recovery — COMPLETE FOR ALL THREE BRANDS

All six live provider credentials are securely stored in `public.limitless_provider_credentials_v2` using the server-side AES-256-GCM provider key.

### CHEFINGS

- Brand: `brand_570bb818-40e1-43c5-b34e-9c8bfbf82f9e`
- Shopify: `5ctqsk-tn.myshopify.com` — recovered/verified.
- Whop: `biz_oSecL7MrGnjRmk` — recovered/verified.

### COZYINFANTS

- Brand: `brand_b014e3c8-06b4-4834-b4a7-772dadf8a607`
- Shopify: `1b1zsq-0y.myshopify.com` — recovered/verified.
- Whop: `biz_ZfAubYoFlaajTC` — recovered/verified.

### FACEJAMAS

- Brand: `brand_dd7799da-caef-4abc-8ee0-1a161e59a2c6`
- Shopify: `f0m103-zz.myshopify.com` — recovered/verified.
- Whop: `biz_MW3bKLHdo3ItcR` — recovered/verified.

Brand metadata has been normalized so all six provider references report `status=verified` and match the encrypted v2 credentials.

No Shopify client secret/access token, Whop API key, webhook secret or provider AES key belongs in Git or browser responses.

## Admin recovery architecture

Fresh Netlify deploys lost reliable access to the original Netlify runtime secrets (`DATABASE_URL`, old admin/session secrets and old provider encryption key). The legacy `limitless.credentials` ciphertext is therefore not a valid runtime dependency.

Current admin path:

- authentication: Supabase Edge Function `limitless-admin-auth-v2`;
- state read: Supabase Edge Function `limitless-admin-state`;
- provider recovery: `limitless-shopify-admin` / `limitless-whop-admin`;
- launch administration: `limitless-launch-admin` (being wired through the Next.js Launch Center routes).

Do not restore the old Netlify-secret dependency.

## Checkout runtime v3 — MIGRATED BACKEND

Supabase migration `20260915191615_checkout_runtime_v3` installs transaction-locked checkout/payment primitives around the existing private Limitless tables.

Active Supabase services:

- `limitless-checkout-runtime` — public cart/view/quote/status runtime; payment start remains gated.
- `limitless-payment-reconciler` — internal service-role-only Whop verification and Shopify completion.
- `limitless-whop-webhook` v5 — signed webhook receiver that invokes the reconciler for real Limitless payments.
- `limitless-launch-admin` — admin policy/readiness/acceptance service.
- `limitless-acceptance-checkout` — separate controlled-acceptance service; not a public-payment bypass.

The Next.js customer cart/start, checkout rendering and quote/status routes have been moved to the Supabase runtime rather than the lost legacy Netlify DB/encryption path.

Verified Netlify production deployment for the first customer-route migration:

- deploy `6aa99c71f5a84e00086a097c`
- state `ready`
- Next.js plugin/build success
- secret scan: zero matches
- branch `hoplite/beroia-65b17429`

Later commits may trigger newer deploys; verify the latest deploy before acceptance testing.

## Payment and reconciliation behavior

The v3 payment design preserves the existing safety invariants:

1. Shopify calculates authoritative product availability, free standard shipping, destination tax and exact USD total.
2. A transaction-locked Limitless payment attempt is created with an idempotency key.
3. Shopify creates one reserved draft order tagged with the Limitless attempt ID.
4. Whop creates one one-time checkout configuration for the exact cents and carries `limitless_attempt_id` metadata.
5. Whop card/wallet fields remain embedded in the branded checkout; raw card/CVV data never passes through Limitless.
6. `payment.succeeded` must have a valid Whop signature and correct brand account.
7. The internal reconciler independently retrieves the Whop payment and verifies company, amount, currency, checkout configuration and Limitless attempt metadata.
8. Exactly one Shopify draft is completed into the paid order under a completion lease/idempotency guard.
9. Duplicate/retried webhooks must not create another Shopify order.
10. Customer confirmation is based on the persisted payment-attempt state, not merely on a browser redirect.

Public customer charging is still disabled until controlled acceptance passes.

## Whop webhook state

All three dedicated Whop `payment.succeeded` endpoints previously passed signed dashboard synthetic tests. Synthetic events prove signature transport only and are never payable.

The receiver is now `limitless-whop-webhook` v5. A real event with both payment ID and `limitless_attempt_id` is passed to the internal reconciler; a synthetic dashboard event remains non-payable.

## FaceJamas personalization / fulfillment architecture

**Do not treat customer artwork display inside checkout as a launch requirement. It is not needed.**

Desired/current architecture:

- Customer uploads a source image to private Supabase storage before checkout.
- The public handoff uses an opaque `pers_…` reference plus a proof; raw image bytes/private storage paths never enter a public cart/payment URL.
- After proof validation, the encrypted cart carries only the opaque personalization reference.
- Shopify draft/order line metadata receives **`Personalization ID`**.
- The customer source image stays private; it does not need to be copied to Shopify public media or embedded into Limitless payment UI.
- The personalization reference is associated with one payment attempt and then the resulting Shopify order.
- Fulfillment can operate by exporting Shopify orders containing `Personalization ID`, then resolving those references through private tooling/API.
- Alternatively, a shipping/production agent can consume an authenticated fulfillment endpoint that returns order context plus a short-lived signed artwork URL.
- Private artwork access must be authenticated/time-limited.
- Ordered source artwork retention: 90 days after order association for fulfillment/replacement support, then private source file deletion; non-image order/audit metadata may remain.

Therefore “artwork binding” means **order-to-artwork association**, not checkout-page image embedding.

## Customer launch policy v2

Canonical policy text is in `docs/STORE_LAUNCH_POLICIES.md` and `lib/server/launch-policies.ts`.

Shared policy:

- USD checkout.
- US, Canada, UK, New Zealand, Australia.
- Free standard shipping.
- Optional $4.99 priority processing once/order, unchecked by default.
- Priority processing is not expedited carrier service and does not guarantee delivery.
- Shopify calculates authoritative taxes and total.
- Whop hosts payment-card entry; raw payment-card data is not collected by the storefront/Limitless.

CHEFINGS / COZYINFANTS:

- eligible non-personalized returns requested within 30 days of delivery;
- items must be unused/original condition;
- damaged, defective or incorrect orders reviewed for replacement/correction/refund;
- cancellations accepted before fulfillment/production but not guaranteed after processing starts;
- priority-processing fee non-refundable after priority processing begins.

FACEJAMAS:

- personalized items final sale except damaged, defective, incorrect or verified production-error cases;
- qualifying issues may be replaced/corrected/refunded;
- cancellation accepted before production but not guaranteed once production begins;
- customer must have rights to uploaded image;
- normal print placement/color variation may occur unless an explicit production proof is provided.

Privacy language explicitly explains that Shopify stores an opaque `Personalization ID`, while authorized fulfillment operators retrieve the private source image using authenticated/time-limited tooling.

Current monitored support contacts:

- `support@chefings.com`
- `support@cozyinfants.com`
- `support@facejamas.com`

Policy v2 has been authored but should not be treated as a real-charge authorization. Record current policy approval in the Launch Center/Supabase launch service before controlled acceptance.

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

All three brands are still `draft/demo` until launch acceptance is complete.

## Remaining work before controlled real payment

1. Finish Next.js wiring for `limitless-launch-admin` and the short-lived private acceptance session/cookie.
2. Sync the live launch-admin policy generator to policy v2.
3. Verify the latest Netlify production deployment after that wiring.
4. Run no-charge storefront cart → branded checkout → authoritative Shopify quote QA on all three brands.
5. Record policy v2 approval for each brand.
6. Arm only the controlled-acceptance gate while public payment remains OFF.
7. Immediately before any real charge, obtain explicit owner authorization.
8. Run the controlled purchase and verify exact Whop payment → signed callback → independent lookup → one Shopify order → confirmed state.
9. For FaceJamas acceptance, verify the Shopify line item has `Personalization ID` and private fulfillment resolution works. No checkout image embedding is required.
10. Verify duplicate/retry behavior cannot create another order.
11. Record acceptance, then ask for explicit authorization before enabling public customer payments.

## Definition of done

A customer can start from the correct Shopify storefront, pass a server-authenticated cart to the matching branded Limitless checkout, review an authoritative Shopify-calculated USD total, pay that exact amount through embedded Whop fields, and receive confirmation only after exactly one corresponding Shopify order exists with all required fulfillment metadata. FaceJamas Shopify orders include an opaque `Personalization ID` that authorized fulfillment tooling can resolve to the correct private source artwork. Retries and duplicate notifications never create duplicate orders or ask a paid customer to pay again.
