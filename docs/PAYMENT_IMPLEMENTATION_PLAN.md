# Limitless payment implementation plan

Reviewed against Shopify Admin API **2026-07** and Whop documentation on 2026-09-10. Store design is not a prerequisite. This plan does not authorize external processing or enable live checkout.

## Working architecture

Limitless remains a private, single-owner, multi-brand application. On 2026-09-10 the owner confirmed that the provider arrangement and physical-product businesses are approved. This is owner-provided confirmation, not independent provider/account verification. The selected design is:

```text
Shopify storefront/cart
  → brand-bound Limitless checkout
  → Shopify-calculated shipping, tax, prices and validated inventory
  → expiring server-owned quote and corresponding reserved Shopify draft
  → brand's Whop embedded/hosted one-time payment
  → signed webhook + independent payment lookup
  → durable payment record and retryable completion of that same Shopify draft
  → Shopify order/fulfillment + Limitless status
```

Shopify stays authoritative for merchandise, shipping/tax configuration, inventory and fulfillment. Limitless must not substitute its demo flat rates or local price snapshots for a live calculation. Whop hosts payment-data collection; Limitless must never receive card numbers. Whop's role does not establish who collects/remits tax for these embedded DTC sales.

Each attempt binds one brand, immutable quote, Shopify store/draft and Whop company/configuration/payment. Browser events are navigation signals, not payment confirmation. Keep the customer informed when payment succeeded but Shopify synchronization needs recovery; never tell them to pay again to fix that condition.

If Shopify does not support this exact private external-payment arrangement, preserve Shopify Checkout and use Whop only through a confirmed supported integration. Do not circumvent Shopify's internal checkout or approved payment-extension requirements.

## Confirmed launch scope

- Destinations: United States (`US`), Canada (`CA`), United Kingdom (`GB`, not `UK`), New Zealand (`NZ`) and Australia (`AU`).
- Currency: **USD everywhere**, including storefront/checkout display, Shopify shop and presentment amounts, Whop checkout and recorded payments. The owner reports both providers are configured in USD. Destination selection must not switch to CAD, GBP, NZD or AUD.
- The checkout country selector and server allowlist use the same five-country definition. USD-only does not establish Markets pricing, shipping, tax or import-duty parity; actual per-country provider acceptance remains necessary.
- Commit and push every completed, verified change to GitHub. Never include credentials, customer records, attachments or unrelated workspace settings in that publication.

## What is implemented

`POST /api/brands/:id/payment-quote` is a **protected administrative diagnostic**, not a customer checkout endpoint:

- Requires administrator authentication, encryption configuration, an exact admin origin and a matching verified Shopify connection. It is disabled in public demo mode and unavailable on checkout domains.
- Rechecks store identity, USD currency, catalog scopes and `write_draft_orders`. Shopify requires the latter even though `draftOrderCalculate` does **not** create a draft.
- Accepts only available imported variants from that brand and a guest shipping address in a launch country. Postal formats are country-specific; state/province codes are required for US/CA/AU, optional for GB/NZ. Client prices, discounts, personalization and custom shipping charges are rejected.
- Requests shipping options, then recalculates a selected option using its freshly discovered Shopify handle. No cached/browser-supplied rate is converted to a custom shipping price.
- Returns exact integer-cent totals, including explicit taxes and the `taxesIncluded` flag. It does not add tax twice or treat absent tax data as zero.
- Blocks on Shopify warnings, missing shipping options and unsupported/incomplete responses. It validates returned variant identities and quantities and rejects changed/digital carts.
- Creates no Shopify draft/order, reserves no stock, persists no customer address, calls no Whop endpoint and always returns `paymentReady: false`. Provider-returned amounts are diagnostic only, not locked prices.

The diagnostic supports **guest US/CA/GB/NZ/AU simple physical-product calculations in USD**. Local address validation checks format, not deliverability; Shopify must supply valid shipping options. Customer exemptions, Markets parity, discount behavior, bundles, subscriptions, FACEJAMAS personalization and actual inventory guarantees still need implementation and acceptance checks. Even a warning-free draft calculation does not establish parity with Shopify Checkout.

### Request/response workflow

After securely connecting a store and importing its catalog, send this from an authenticated same-origin admin session, with `Content-Type: application/json`. Substitute an imported product ID from that brand; do not place tokens in requests, console examples or source control.

```json
{
  "items": [{ "productId": "IMPORTED_PRODUCT_ID", "quantity": 1 }],
  "shippingAddress": {
    "firstName": "Test",
    "lastName": "Buyer",
    "address1": "123 Example Street",
    "city": "Portland",
    "provinceCode": "OR",
    "zip": "97201",
    "countryCode": "US"
  }
}
```

The initial response has `status: "shipping_selection_required"` or `"blocked"`. Select a returned `shippingRates[].handle` and repeat with `shippingRateHandle`. A successful recalculation has `status: "calculated"`, exact `totals.*Cents`, and still **`paymentReady: false`**. The response is `no-store`, with no reusable payment token. Addresses are sent to Shopify for calculation but are not echoed or saved by this endpoint. Use designated test addresses when checking actual stores.

## Remaining implementation sequence

1. **Account integration and pricing acceptance.** Provider approval and launch scope are owner-confirmed. Verify USD configuration, tax responsibilities, scopes/roles, fees and actual per-brand access. Compare this diagnostic with Shopify's expected totals for representative carts in each of the five countries, including cross-border shipping/tax and any duties. Do not overwrite the public demo calculator with unverified provider behavior.
2. **Cart and quote lifecycle.** Authenticated brand-bound cart handoff; server validation of variants, quantities, discounts and personalization references; live availability checks; expiring immutable quotes. Requote after any address/rate/cart change. Reserve inventory on the corresponding draft and define reservation expiry behavior.
3. **Payment session and durable ledger.** Persist an attempt before remote side effects. Store integer cents and immutable account/quote bindings; create the actual Whop checkout. Define the chosen endpoint's idempotency and recovery behavior before enabling retries. A reusable checkout configuration is not a one-charge guarantee.
4. **Webhook inbox and reconciliation worker.** Verify signatures against raw bytes with the supported SDK/spec, enforce timestamp/replay checks, persist delivery before acknowledgment, and independently retrieve payment status/account/amount/currency/metadata. Deduplicate event IDs and payment IDs transactionally. Record a second successful payment against the same quote as an exception for refund review, not a second fulfillment order.
5. **Shopify completion and recovery.** Hold a durable completion lease. Complete only the stored draft for the verified payment; after a timeout, query that draft for an existing order before retrying. Persist paid-but-unsynced errors, retry schedules and recovery audit history. Never use a new draft/order to hide an uncertain completion outcome. Expired, underpaid or mismatched paid attempts need reconciliation, not blind repricing.
6. **Personalization and operations.** FACEJAMAS uploads need durable private storage and access-controlled fulfillment references, plus retention/deletion policy. Add refund/dispute handling, reconciliation visibility, alerts, backup/restore and deployment health checks. Synthetic failures must exercise each recovery path before shopper traffic.
7. **Deployment and acceptance.** Deploy the secured backend, configure DNS/HTTPS and provider callbacks, verify each brand's account/domain isolation, then run provider-supported test-mode transactions. A real purchase/refund requires explicit owner approval. Only verified acceptance results can replace the hard live-publish block.

For the current SQLite implementation, plan a **single writable application instance with persistent storage**, not stateless/free ephemeral hosting or multiple replicas sharing an unsafe SQLite volume. A durable worker must recover jobs after restarts; fire-and-forget work after returning HTTP 200 is not a reliable payment queue. Hosting vendor/size can be selected after resource tests; no hosting purchase is required to implement these stages locally.

## Account status and remaining operational details

Provider approval and the five-country USD scope are owner-confirmed. Integration acceptance must still establish these operational details; the approval confirmation does not substitute for functioning credentials or completed payment code:

- Shopify: Confirm effective scopes/roles, customer-data access, transaction classification, fees, shipping zones and tax/duty behavior against the actual accounts.
- Whop: Verify test-environment access, effective USD payment methods, tax responsibilities, refunds/disputes and repeated-payment handling for each company.
- Merchant: Specify required Shopify discounts, tax exemptions, bundles and personalization features as their implementation begins.

Obtain provider answers through the owners' authenticated support channels. Never paste API keys, webhook secrets or customer data into a support-template document, chat transcript or Git commit. Provider capability documentation is not merchant-specific authorization.

## Verification and references

Automated tests cover money parsing, input rejection, fresh shipping selection, tax-inclusive/zero-tax handling, warnings, changed/unsupported carts, missing scopes, outages, account mismatch, credential rotation and API security. They use **synthetic provider responses**, not actual accounts; no payment or order was created.

The initial US-only milestone passed 44 tests, TypeScript, the production build and an isolated production HTTP security smoke test. The five-country extension passes all 49 tests, TypeScript and the production build, with coverage for each destination, address formats, USD-only rates/totals, absent shipping configurations and the shared demo-checkout allowlist. Browser verification of the country menu is pending: the managed Preview startup tool requires an optional promotion argument before any listener exists, blocking startup; this platform issue has been reported. Actual Shopify/Whop account connectivity, pricing parity and payment behavior remain unverified.

- [Shopify draftOrderCalculate (2026-07)](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/draftOrderCalculate)
- [CalculatedDraftOrder (2026-07)](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/CalculatedDraftOrder)
- [DraftOrderInput (2026-07)](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/DraftOrderInput)
- [ShippingLineInput (2026-07)](https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/ShippingLineInput)
- [Whop checkout configuration](https://docs.whop.com/api-reference/checkout-configurations/checkout-configuration)
- [Whop webhooks](https://docs.whop.com/developer/guides/webhooks)
- [Whop physical-product commerce](https://docs.whop.com/supported-business-models/dtc-ecommerce)
- [Policy distinctions and further payment evidence](PAYMENT_ARCHITECTURE.md)
