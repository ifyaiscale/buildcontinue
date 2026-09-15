# Limitless Checkout — current handoff

Last updated: 2026-09-15.

## Current production state

Production branch: `hoplite/beroia-65b17429`.

Current verified Netlify production deploy before this docs-only update:

- Deploy: `6aa8e87c69e3f5000803347f`
- State: `ready`
- Application commit: `8e1ffb84da4a65e6063d543f0a777b14b567e13d`
- Title: `Use manual Whop webhook secret when provided`

Customer charging remains OFF. `PUBLIC_PAYMENT_ENABLED=false` remains the required production state. Do not enable public payment without explicit owner authorization and a controlled acceptance purchase.

## 2026-09-15 recovery architecture

A fresh Netlify deployment could no longer read the original sensitive runtime values used by the earlier backend (`DATABASE_URL`, admin/session secrets and the original credential-encryption key). The original `limitless.credentials` provider ciphertext therefore remains unreadable on fresh deployments. Do not generate a replacement key and pretend those old ciphertext rows are usable.

The recovery path now moves sensitive admin/provider operations into Supabase instead of depending on Netlify secret environment persistence.

### Admin auth/state — recovered

- Workspace login is backed by Supabase Edge Function `limitless-admin-auth-v2`.
- Workspace state is backed by Supabase Edge Function `limitless-admin-state`.
- Netlify routes `/api/auth/login`, `/api/auth/logout` and `/api/state` bridge to those services.
- Login and read-only workspace loading are verified working in production.
- Do not restore the old Netlify admin/session-secret dependency.

### New provider credential vault

New provider credentials are stored in the private Supabase tables:

- `public.limitless_provider_crypto_material`
- `public.limitless_provider_credentials_v2`

Credentials are encrypted with AES-256-GCM before storage. The encryption key remains server-side. Provider secrets must never be committed to GitHub or returned to the browser after saving.

The original legacy credential ciphertext remains separate and unreadable without the lost original Netlify encryption key. Each provider connection therefore needs a one-time controlled re-entry into the new vault.

### COZYINFANTS Whop — recovered

COZYINFANTS Whop has been re-verified and securely saved into the new Supabase provider vault.

- Brand ID: `brand_b014e3c8-06b4-4834-b4a7-772dadf8a607`
- Company ID remains: `biz_ZfAubYoFlaajTC`
- Exactly one encrypted `whop` row exists in `limitless_provider_credentials_v2` for Cozy.
- No API key or signing secret is stored in Git or this handoff.

The Whop webhook was created manually in the Whop dashboard because automatic webhook provisioning returned HTTP 400 against the current Whop API.

Cozy webhook endpoint:

`https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-whop-webhook?brand=brand_b014e3c8-06b4-4834-b4a7-772dadf8a607`

Webhook settings:

- API version `v1`
- Event `payment.succeeded` only
- Connected-account events OFF
- Enabled ON

The signing secret is stored encrypted with the Cozy Whop credential bundle.

### Whop receiver — current status

Supabase Edge Function `limitless-whop-webhook` is ACTIVE at version 2.

Version 2 fixes:

- AES vault key imported as raw 32-byte AES-256 material rather than Deno-rejected JWK metadata.
- Whop `whsec_...` / `ws_...` Standard Webhooks secrets are decoded to their base64 HMAC key material before HMAC-SHA256 verification.
- Raw request body is used for verification.
- `webhook-id`, `webhook-timestamp` and `webhook-signature` are required.
- Five-minute replay window enforced.
- Event must be `api_version=v1` and `type=payment.succeeded`.
- Event company must match the encrypted brand Whop company ID.
- Webhook recording is idempotent by webhook message ID.

`public.limitless_record_whop_webhook_event` was corrected so the database generates `limitless.webhook_events.sequence` itself. The prior implementation manually wrote an `IDENTITY ALWAYS` column and would have failed with PostgreSQL `428C9`.

A Whop dashboard test delivery should be run before any real payment acceptance.

### Known identity-column issue outside the receiver

`limitless.activity.sequence` is also `GENERATED ALWAYS AS IDENTITY`. The older provider connection-commit RPC manually writes this column and can fail with PostgreSQL `428C9`.

The current COZYINFANTS Whop recovery service (`limitless-whop-admin` v4) deliberately bypasses that activity/brand rewrite and only:

1. validates the already-assigned Whop company ID,
2. verifies the Whop API key against the real company,
3. encrypts the API key + webhook signing secret,
4. upserts the encrypted vault row.

Do not use the old connection-commit path for additional recovered providers until this identity-column bug is removed or an equivalent safe recovery path is used.

## Provider recovery still required

Brand metadata still shows the previously verified provider account IDs, but that does not mean the old legacy provider secrets are decryptable.

Remaining one-time vault recovery:

- CHEFINGS Whop credential + webhook signing secret.
- FACEJAMAS Whop credential + webhook signing secret.
- CHEFINGS Shopify credential.
- COZYINFANTS Shopify credential.
- FACEJAMAS Shopify credential.

Use existing brand/provider account IDs as consistency checks. Never describe these brands as historically unconnected; the issue is recoverability of the provider secret material on the fresh runtime.

## Payment backend status — not acceptance-ready yet

The new Supabase Whop receiver can verify and record a signed `payment.succeeded` event, but the full post-webhook payment pipeline has not yet been migrated off the legacy Netlify credential/database dependency.

Before a controlled real charge, the Supabase-backed path must also perform the equivalent of the previous durable flow:

- identify the Limitless payment attempt,
- verify the Whop payment against company, amount, currency, checkout configuration and attempt metadata,
- transition the attempt exactly once,
- create/complete exactly one Shopify order,
- preserve retry/idempotency protections,
- bind FaceJamas personalization where applicable,
- expose confirmation only after successful reconciliation.

Do not run a real payment merely because the webhook receiver returns 2xx.

## Completed application work

- Encrypted storefront cart handoff using Shopify variant IDs and quantities.
- Server-authoritative Shopify quote, destination tax and USD total.
- Exact-value Whop hosted payment flow design with signed callback verification.
- Durable payment attempts, idempotency and retry/recovery workers in the legacy application path.
- Exactly-once Shopify order completion protections in the legacy application path.
- Branded checkout origin routing for:
  - `https://checkout.chefings.com`
  - `https://checkout.cozyinfants.com`
  - `https://checkout.facejamas.com`
- FaceJamas private personalization upload, proof verification, order binding and private fulfillment artwork access.
- Launch Center, versioned customer policies and controlled activation checks.
- Three brand storefront designs and Shopify OS 2.0 release packages prepared outside the repository for upload to each corresponding Shopify store.

## Brand/provider metadata

All three brands remain `draft / demo` for safety.

- CHEFINGS: Shopify metadata verified, Whop metadata verified, 2 synced variants.
- COZYINFANTS: Shopify metadata verified, Whop metadata verified, 5 synced variants; Whop secret bundle has now been recovered into the new Supabase vault.
- FACEJAMAS: Shopify metadata verified, Whop metadata verified, 3 synced variants; private personalization workflow is implemented.

Support contacts are configured as `support@chefings.com`, `support@cozyinfants.com`, and `support@facejamas.com`, but inbox monitoring must be confirmed before policy approval.

## Storefront architecture

Main brand domains are Shopify-hosted storefronts:

- `chefings.com`
- `cozyinfants.com`
- `facejamas.com`

Only branded checkout subdomains should point to the Netlify-hosted Limitless Checkout application:

- `checkout.chefings.com`
- `checkout.cozyinfants.com`
- `checkout.facejamas.com`

The prepared Shopify themes contain per-brand cart drawers and checkout bridges that POST only validated Shopify variant IDs, quantities and, for FaceJamas, the verified personalization reference/proof to the matching branded checkout origin.

## Fixed launch policy

- Currency: USD.
- Launch countries: US, Canada, UK, New Zealand, Australia.
- Standard shipping: free.
- Optional priority processing: $4.99 USD once per order, unchecked by default.
- Browser prices, shipping, tax and totals are never authoritative.

## Remaining launch actions — ordered

1. Send and verify a Whop dashboard test `payment.succeeded` delivery to the Cozy Supabase webhook endpoint.
2. Recover CHEFINGS and FACEJAMAS Whop credentials into the Supabase vault and create/store their dedicated signed webhook endpoints.
3. Recover all three Shopify credentials into the Supabase vault.
4. Migrate quote/payment/reconciliation/Shopify completion operations off the legacy Netlify database/encryption dependency.
5. Run no-charge cart → branded checkout → authoritative Shopify quote QA for all three brands.
6. Confirm all three support inboxes are monitored.
7. Owner reviews and explicitly approves current shipping/returns/privacy policies.
8. Keep `PUBLIC_PAYMENT_ENABLED=false`; immediately before any real charge obtain explicit owner authorization.
9. Run a single controlled acceptance purchase and verify signed Whop event, payment verification, exactly one Shopify order, confirmation state, retry idempotency and FaceJamas artwork binding where applicable.
10. Only after acceptance passes ask for explicit authorization to enable public customer payments.

## Definition of done

A customer can start on a Shopify-hosted brand storefront, pass a server-authenticated cart to the matching branded Limitless checkout, review an authoritative Shopify-calculated USD total, pay exactly that amount through Whop, and receive confirmation only after exactly one corresponding Shopify order exists with all required fulfillment data. Retries and duplicate notifications must never create duplicate orders or ask a paid customer to pay again.
