# Limitless Checkout — current handoff

Last updated: 2026-09-15.

## Safety state

- Production branch: `hoplite/beroia-65b17429`.
- Customer charging remains OFF.
- `PUBLIC_PAYMENT_ENABLED=false` must remain in production until controlled acceptance succeeds and the owner explicitly authorizes public payments.
- Do not run a real charge merely because webhook transport now works.

## 2026-09-15 recovery architecture

Fresh Netlify deploys no longer had reliable access to the original sensitive runtime values used by the legacy backend (`DATABASE_URL`, admin/session secrets, and the original provider credential-encryption key). The original `limitless.credentials` ciphertext therefore remains unreadable on fresh deployments.

Sensitive admin/provider operations have been moved toward Supabase instead of depending on Netlify secret persistence.

### Admin auth/state

- Workspace login: Supabase Edge Function `limitless-admin-auth-v2`.
- Workspace state: Supabase Edge Function `limitless-admin-state`.
- Netlify routes bridge login/logout/state to those services.
- Login and workspace loading are verified working.
- Do not restore the old Netlify admin/session-secret dependency.

### Provider credential vault v2

Private tables:

- `public.limitless_provider_crypto_material`
- `public.limitless_provider_credentials_v2`

New provider credentials are encrypted with AES-256-GCM before storage. The key stays server-side. Provider secrets must never be committed to GitHub or returned to the browser after saving.

The legacy provider ciphertext remains separate and unreadable without the lost original key. Each provider therefore needs a one-time controlled re-entry into the v2 vault.

## Whop recovery — ALL THREE BRANDS COMPLETE

All three brand Whop credentials have now been re-verified and securely stored in the Supabase v2 provider vault. Each brand has a dedicated manually-created Whop webhook for `payment.succeeded`, and each webhook has passed a signed Whop dashboard test with HTTP 200.

### CHEFINGS

- Brand ID: `brand_570bb818-40e1-43c5-b34e-9c8bfbf82f9e`
- Company ID: `biz_oSecL7MrGnjRmk`
- Exactly one encrypted `whop` credential row exists in `limitless_provider_credentials_v2`.
- Webhook endpoint:
  `https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-whop-webhook?brand=brand_570bb818-40e1-43c5-b34e-9c8bfbf82f9e`
- Signed dashboard `payment.succeeded` test returned HTTP 200.
- Supabase confirms one persisted Chefings webhook event (`sequence=2`).

### COZYINFANTS

- Brand ID: `brand_b014e3c8-06b4-4834-b4a7-772dadf8a607`
- Company ID: `biz_ZfAubYoFlaajTC`
- Exactly one encrypted `whop` credential row exists in `limitless_provider_credentials_v2`.
- Webhook endpoint:
  `https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-whop-webhook?brand=brand_b014e3c8-06b4-4834-b4a7-772dadf8a607`
- Signed dashboard `payment.succeeded` test returned HTTP 200.
- Supabase confirms one persisted Cozy webhook event (`sequence=1`).

### FACEJAMAS

- Brand ID: `brand_dd7799da-caef-4abc-8ee0-1a161e59a2c6`
- Company ID: `biz_MW3bKLHdo3ItcR`
- Exactly one encrypted `whop` credential row exists in `limitless_provider_credentials_v2`.
- Webhook endpoint:
  `https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-whop-webhook?brand=brand_dd7799da-caef-4abc-8ee0-1a161e59a2c6`
- Signed dashboard `payment.succeeded` test returned HTTP 200.
- Supabase confirms one persisted FaceJamas webhook event (`sequence=3`).

No Whop API keys or signing secrets are stored in Git or this handoff.

### Whop connection service

`limitless-whop-admin` v4 is the active Whop recovery service.

It validates the brand/company, verifies the Whop API key, encrypts the API key + webhook signing secret with AES-256-GCM, and upserts the encrypted v2 vault row. It deliberately bypasses the older connection-commit activity write because `limitless.activity.sequence` is `GENERATED ALWAYS AS IDENTITY` and the older RPC can fail with PostgreSQL `428C9` by manually writing that column.

### Whop receiver — verified transport

Supabase Edge Function `limitless-whop-webhook` is ACTIVE at version 4.

Current receiver behavior:

- Reads encrypted Whop credentials from the v2 vault.
- Imports the vault AES key as raw 32-byte AES-256 material.
- Verifies the raw request body using `webhook-id`, `webhook-timestamp`, and `webhook-signature`.
- Uses the Whop `ws_...` / `whsec_...` signing secret exactly as stored as UTF-8 HMAC key material; only the `v1,<signature>` header payload is base64-decoded.
- Enforces a five-minute replay window.
- Requires `api_version=v1` and `type=payment.succeeded`.
- Records webhook message IDs idempotently in `limitless.webhook_events`.
- Synthetic Whop dashboard test events are accepted only as synthetic transport tests and are never treated as payable orders.
- A real Limitless event with a `limitless_attempt_id` remains subject to brand/account and payment verification before any order completion.

The webhook event recorder was corrected so Postgres generates `limitless.webhook_events.sequence` itself. The previous implementation manually wrote an `IDENTITY ALWAYS` column and would have failed with PostgreSQL `428C9`.

All three Whop dashboard tests returned HTTP 200 and persisted successfully. This proves signed webhook transport and persistence. It does NOT prove the real payment reconciliation path.

## Shopify recovery

### CHEFINGS — COMPLETE

- Store domain: `5ctqsk-tn.myshopify.com`.
- Existing Dev Dashboard app: `Limitless - CHEFINGS`.
- App has the required current scopes: `read_products`, `read_inventory`, `read_draft_orders`, `write_draft_orders`.
- Connection method: Dev Dashboard app / client credentials grant with automatic short-lived token renewal.
- User completed verification successfully through the Limitless dashboard.
- Supabase confirms exactly one encrypted `shopify` credential row for Chefings in `public.limitless_provider_credentials_v2`.
- Brand metadata has been backfilled safely without using the broken activity-sequence path and now reports Shopify `status=verified`, account `5ctqsk-tn.myshopify.com`.
- No Shopify client secret or access token is stored in Git or this handoff.

### COZYINFANTS — STILL TO RECOVER

- Store domain: `1b1zsq-0y.myshopify.com`.
- Use the corresponding Dev Dashboard app if present and select `Dev Dashboard app (automatic token renewal)` in Limitless.
- Required minimum scopes: `read_products`, `read_inventory`, `read_draft_orders`, `write_draft_orders`.

### FACEJAMAS — STILL TO RECOVER

- Store domain: `f0m103-zz.myshopify.com`.
- Use the corresponding Dev Dashboard app if present and select `Dev Dashboard app (automatic token renewal)` in Limitless.
- Required minimum scopes: `read_products`, `read_inventory`, `read_draft_orders`, `write_draft_orders`.

Do not describe these stores as historically unconnected. The recovery issue concerns provider secret material on the fresh runtime.

## Payment backend status — NOT acceptance-ready yet

Signed Whop webhook transport is now working for all three brands, but the full post-payment reconciliation path has not yet been migrated off all legacy Netlify credential/database dependencies.

Before any controlled real charge, the Supabase-backed path must safely:

1. identify the Limitless payment attempt,
2. fetch/verify the Whop payment against the correct company, amount, currency, checkout configuration, and attempt metadata,
3. transition the attempt exactly once,
4. create/complete exactly one Shopify order,
5. preserve retry/idempotency protections,
6. bind FaceJamas personalization where applicable,
7. expose confirmation only after successful reconciliation.

Public payments remain OFF throughout this work.

## Storefront architecture / fixed launch policy

Main Shopify storefronts:

- `chefings.com`
- `cozyinfants.com`
- `facejamas.com`

Branded checkout origins:

- `checkout.chefings.com`
- `checkout.cozyinfants.com`
- `checkout.facejamas.com`

Launch policy:

- Currency: USD.
- Countries: US, Canada, UK, New Zealand, Australia.
- Standard shipping: free.
- Priority processing: $4.99 USD once per order, unchecked by default.
- Browser prices/tax/shipping/totals are never authoritative.

## Next actions — ordered

1. Recover COZYINFANTS Shopify into the v2 vault and verify backend state.
2. Recover FACEJAMAS Shopify into the v2 vault and verify backend state.
3. Migrate quote/payment/reconciliation/Shopify-completion operations off remaining legacy Netlify credential/database dependencies.
4. Run no-charge cart → branded checkout → authoritative Shopify quote QA for all three brands.
5. Confirm support inboxes and approve shipping/returns/privacy policies.
6. Keep `PUBLIC_PAYMENT_ENABLED=false`; immediately before any real charge obtain explicit owner authorization.
7. Run one controlled acceptance purchase and verify signed Whop event, payment verification, exactly one Shopify order, confirmation state, retry idempotency, and FaceJamas artwork binding where applicable.
8. Only after acceptance passes ask for explicit authorization to enable public customer payments.

## Definition of done

A customer can start on a Shopify-hosted brand storefront, pass a server-authenticated cart to the matching branded Limitless checkout, review an authoritative Shopify-calculated USD total, pay exactly that amount through Whop, and receive confirmation only after exactly one corresponding Shopify order exists with all required fulfillment data. Retries and duplicate notifications must never create duplicate orders or ask a paid customer to pay again.
