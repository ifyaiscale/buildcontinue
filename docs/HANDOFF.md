# Limitless Checkout — current handoff

Last updated: 2026-09-15.

## Safety state

- Production branch: `hoplite/beroia-65b17429`.
- Current verified Netlify production deploy before this docs-only update: deploy `6aa8e87c69e3f5000803347f`, application commit `8e1ffb84da4a65e6063d543f0a777b14b567e13d`, state `ready`.
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

## COZYINFANTS Whop — recovered and webhook transport verified

COZYINFANTS Whop is now successfully recovered into the new Supabase credential vault.

- Brand ID: `brand_b014e3c8-06b4-4834-b4a7-772dadf8a607`
- Company ID: `biz_ZfAubYoFlaajTC`
- Exactly one encrypted `whop` credential row exists for Cozy in `limitless_provider_credentials_v2`.
- No API key or signing secret is stored in Git or this handoff.
- `limitless-whop-admin` v4 is the active recovery service for Whop credential verification + encrypted vault save.
- v4 deliberately bypasses the older connection-commit activity write that can fail on `limitless.activity.sequence` (`IDENTITY ALWAYS`, PostgreSQL `428C9`).

The Cozy Whop webhook was created manually in the Whop dashboard.

Endpoint:

`https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-whop-webhook?brand=brand_b014e3c8-06b4-4834-b4a7-772dadf8a607`

Settings:

- API version `v1`
- Event `payment.succeeded` only
- Connected-account events OFF
- Enabled ON

The signing secret is stored encrypted with the Cozy Whop credential bundle.

### Whop receiver — verified transport

Supabase Edge Function `limitless-whop-webhook` is ACTIVE at version 4.

Current receiver behavior:

- Reads encrypted Whop credentials from the v2 vault.
- Imports the vault AES key as raw 32-byte AES-256 material, avoiding the Deno JWK import incompatibility.
- Verifies the raw request body using `webhook-id`, `webhook-timestamp`, and `webhook-signature`.
- Uses the Whop `ws_...` / `whsec_...` signing secret exactly as stored as UTF-8 HMAC key material; only the `v1,<signature>` header payload is base64-decoded.
- Enforces a five-minute replay window.
- Requires `api_version=v1` and `type=payment.succeeded`.
- Records webhook message IDs idempotently in `limitless.webhook_events`.
- Synthetic Whop dashboard test events are accepted only as synthetic transport tests and are never treated as payable orders.
- A real Limitless event with a `limitless_attempt_id` remains subject to brand/account and payment verification before any order completion.

The webhook event recorder was corrected so Postgres generates `limitless.webhook_events.sequence` itself. The previous implementation manually wrote an `IDENTITY ALWAYS` column and would have failed with PostgreSQL `428C9`.

### Verified Cozy test result

A Whop dashboard `payment.succeeded` test returned HTTP 200:

```json
{"received":true,"duplicate":false,"syntheticTest":true,"accountMatchesBrand":false,"paymentIdentified":false}
```

This is the expected synthetic-test result: signature verification passed, the request was accepted, no Limitless payment attempt was identified, and no real order/payment processing occurred.

Supabase confirms one Cozy webhook event is persisted (`sequence=1`).

## Provider recovery still required

Historical provider account metadata remains present, but the old provider secrets are not decryptable on the fresh runtime.

Remaining one-time recovery:

- CHEFINGS Whop credential + dedicated webhook signing secret.
- FACEJAMAS Whop credential + dedicated webhook signing secret.
- CHEFINGS Shopify credential.
- COZYINFANTS Shopify credential.
- FACEJAMAS Shopify credential.

Known Whop company IDs:

- CHEFINGS: `biz_oSecL7MrGnjRmk`
- COZYINFANTS: `biz_ZfAubYoFlaajTC`
- FACEJAMAS: `biz_MW3bKLHdo3ItcR`

Do not describe these brands as historically unconnected. The recovery issue concerns provider secret material on the fresh runtime.

## Payment backend status — NOT acceptance-ready yet

Webhook transport is now working for Cozy, but the full post-payment reconciliation path has not yet been migrated off all legacy Netlify credential/database dependencies.

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

1. Recover CHEFINGS Whop into the v2 vault, create its manual `payment.succeeded` webhook, and confirm an HTTP 200 synthetic test.
2. Recover FACEJAMAS Whop the same way and confirm an HTTP 200 synthetic test.
3. Recover all three Shopify credentials into the v2 vault.
4. Migrate quote/payment/reconciliation/Shopify-completion operations off remaining legacy Netlify credential/database dependencies.
5. Run no-charge cart → branded checkout → authoritative Shopify quote QA for all three brands.
6. Confirm support inboxes and approve shipping/returns/privacy policies.
7. Keep `PUBLIC_PAYMENT_ENABLED=false`; immediately before any real charge obtain explicit owner authorization.
8. Run one controlled acceptance purchase and verify signed Whop event, payment verification, exactly one Shopify order, confirmation state, retry idempotency, and FaceJamas artwork binding where applicable.
9. Only after acceptance passes ask for explicit authorization to enable public customer payments.

## Definition of done

A customer can start on a Shopify-hosted brand storefront, pass a server-authenticated cart to the matching branded Limitless checkout, review an authoritative Shopify-calculated USD total, pay exactly that amount through Whop, and receive confirmation only after exactly one corresponding Shopify order exists with all required fulfillment data. Retries and duplicate notifications must never create duplicate orders or ask a paid customer to pay again.
