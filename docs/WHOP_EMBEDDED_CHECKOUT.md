# Embedded Whop checkout

The shared customer checkout now embeds Whop payment fields directly on the branded checkout domain instead of redirecting shoppers to a Whop-hosted page.

## Flow

1. Shopify remains authoritative for product, shipping, tax, and total calculation.
2. Once a valid delivery form has an authoritative quote and public payment is enabled, the server creates the existing idempotent payment attempt, Shopify draft order, and one-time Whop checkout configuration.
3. The customer API returns only the Whop `plan_...` identifier, `ch_...` checkout session identifier, the branded receipt return URL, and verified total metadata.
4. The browser mounts Whop's official embedded checkout iframe on the same `checkout.<brand>.com` page. Email and shipping address are prefilled from the already-validated checkout form so duplicate fields can be hidden.
5. Raw card/CVV data stays inside Whop's iframe and never passes through Limitless or Shopify application code.
6. Existing signed webhook verification, payment ledger reconciliation, Shopify draft completion, and FaceJamas personalization binding remain unchanged.

## Brands

The implementation lives in the shared checkout and therefore applies to Chefings, Cozy Infants, and FaceJamas. Brand-specific Whop accent presets are orange, indigo, and violet respectively.

## Launch gates

`PAYMENT_ACCEPTANCE_ENABLED` and `PUBLIC_PAYMENT_ENABLED` remain the public payment gates. Do not enable them until all three launch candidates, policies, webhooks, and controlled end-to-end acceptance checks are complete and an explicit live-payment authorization has been given.
