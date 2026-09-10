# Payment integration: evidence and remaining decisions

Reviewed 2026-09-10. This is a private, merchant-owned tool for multiple Shopify brands, not an App Store product. No provider credentials, real orders, or payments were used for this research. **Hosting is not the only remaining launch gate.**

## What the official documentation establishes

- [Whop embedded checkout](https://docs.whop.com/payments/checkout-embed) provides a hosted iframe that can live inside a custom page. Redirects, return URLs, and externally authenticated payment methods still need handling. Browser success callbacks or URL parameters must not be treated as server-side proof of payment.
- [Whop DTC e-commerce](https://docs.whop.com/supported-business-models/dtc-ecommerce) explicitly describes physical-product sales and webhook-triggered fulfillment. This does not establish Shopify shipping/Markets parity, approval of a specific merchant's products, or automatic order synchronization.
- [Whop tax guidance](https://docs.whop.com/payments-and-billing/fees/taxes) distinguishes external/embedded DTC sales: do not assume Whop calculates or remits these taxes on the merchant's behalf.
- Shopify's [2026-07 Cart](https://shopify.dev/docs/api/storefront/2026-07/objects/Cart) leads buyers to `checkoutUrl` for Shopify Checkout. [CartCost](https://shopify.dev/docs/api/storefront/2026-07/objects/CartCost) is an estimate subject to change at checkout. A missing tax amount is not evidence that zero tax is owed.
- [draftOrderCalculate](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/draftOrderCalculate) can calculate a proposed draft without creating it. [CalculatedDraftOrder](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/CalculatedDraftOrder) includes shipping rates and monetary breakdowns, with warnings that must be handled. Currency alone does not establish Markets-price parity; Shopify documents that [marketRegionCountryCode does not affect drafts on shops using Markets](https://shopify.dev/changelog/new-warning-draftordermarketregioncountrycodenotsupportedwarning-added-to-draftorder).
- [draftOrderComplete](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/draftOrderComplete) converts a draft to an order, and Shopify documents [marking drafts paid after payment elsewhere](https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/get-paid). These are documented capabilities, not blanket authorization for an automated replacement of Shopify Checkout.
- [orderCreate](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/orderCreate) supports external-system imports with an offline token and `write_orders`. It does not automatically apply automatic discounts and supports only one discount code. It is not a drop-in Shopify Checkout calculator.

## Permission is distinct from API capability

Shopify's [App Store requirements, §1.1.2](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements) explicitly prohibit bypassing checkout for App Store eligibility. That page alone does **not** establish that this private merchant-owned integration is prohibited. Equally, private ownership does not grant access to Shopify's approved payments platform. [Offsite payments extensions](https://shopify.dev/docs/apps/build/payments/offsite/use-the-cli) require Payments Partner approval.

On 2026-09-10, the owner confirmed that the Shopify/Whop arrangement and physical-product businesses are approved. This is recorded as owner-provided confirmation, not an independently reviewed provider decision or successful account test. Proceed with the external-flow implementation; verify actual account permissions, transaction classification, applicable fees, tax responsibilities and operational behavior during integration acceptance.

## Integration paths — owner-confirmed approval, live implementation still pending

1. **Lowest integration uncertainty:** preserve Shopify Checkout via `checkoutUrl`. Use Whop there only if a supported, approved integration is confirmed. This does not promise the same fully custom checkout layout.
2. **Selected external flow:** calculate and validate a Shopify draft → retain an expiring server-owned quote → create a Whop payment checkout → verify a signed payment event and authoritative amount/currency/account → complete that draft once. The owner has confirmed approval; implementation and account-specific tests are still required before live use.

A generic public API that completes a Shopify Storefront Cart using an arbitrary Whop receipt has not been established. Do not rely on Shopify internal checkout endpoints or obsolete completion APIs.

The [implementation plan](PAYMENT_IMPLEMENTATION_PLAN.md) uses the external flow based on the owner's confirmation, with Shopify Checkout as the fallback if integration acceptance reveals a provider restriction. Launch scope is US, Canada, UK (`GB`), New Zealand and Australia with USD display, quotes and payments throughout. The first implemented slice is an authenticated Shopify draft-calculation diagnostic; no live session, draft creation/completion, or webhook handler is implemented.

Whop describes a checkout configuration as reusable; creating a configuration for a quote does not guarantee a single payment. Deduplicate individual payment IDs **and** enforce one fulfillment result per quote, recording additional successful payments for reconciliation/refund review rather than silently ignoring money received. Do not assume an idempotency feature documented for Whop's Experimental API also applies to the chosen v1 endpoint without verifying that endpoint's contract.

## Required pre-launch implementation and acceptance

- Storefront cart handoff; server-side validation of variants, quantities, availability, country, shipping options, discounts, and exact payable totals.
- Expiring immutable quotes and correct handling of changed rates, tax-inclusive/exempt orders, Markets pricing, and inventory races.
- Whop payment sessions and the actual embedded component, not demo wallet/card marks.
- Signed raw-body webhooks, timestamp/replay checks, durable event/payment deduplication, and server-side payment verification. Webhook signature authentication is separate from browser-origin checks.
- Exactly-once business effects using durable state, retries, and reconciliation; visible paid-but-unsynced exceptions; documented recovery/refund paths.
- Personalization transfer: [cart line attributes](https://shopify.dev/docs/api/storefront/2026-07/input-objects/CartLineInput), draft `customAttributes`, or imported [order-line properties](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/OrderCreateLineItemInput). Private artwork needs durable, access-controlled storage, not an unrestricted URL or a catalog image.
- Per-brand provider test transactions and shipping/tax/order-parity checks. Follow with an explicitly authorized real purchase/refund acceptance test.

Production hosting and DNS can remain the deployment stage after local implementation. Final HTTPS callbacks, domain/wallet verification, real-account connectivity, backup restoration, and end-to-end acceptance still need a reachable deployment or suitable secure test endpoint. A passing local build cannot verify those gates.
