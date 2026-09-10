# Limitless Checkout — system overview

## Purpose and current status

Limitless is a **private, single-owner workspace for managing multiple Shopify brands and their existing Whop businesses**. It is not a subscription SaaS being sold to other merchants.

The working application includes the management dashboard, branded checkout design, saved account identifiers, provider read-access verification, catalog import, and a no-charge demo order flow. **It is not ready to accept real payments.** Live publication is explicitly blocked on the server. Publishing this repository does not deploy the app or connect any accounts.

The dashboard uses Limitless's black, white, and purple theme. Each brand's checkout has independent colors, copy, and conversion blocks.

## Who uses each part?

| Surface | Intended user | What it does today |
| --- | --- | --- |
| Management dashboard (`/`) | The owner | Manage brands, account details, checkout settings, demo orders, and connections |
| Brand checkout (`/checkout/:slug`) | Owner/test shoppers | Show the branded form and create a no-charge demo order |
| Management API (`/api/brands/*`, `/api/state`) | The authenticated dashboard | Validate and persist changes; call provider APIs for supported verification/import operations |
| Checkout API (`/api/checkout/:slug`) | A checkout page | Return sanitized brand data and calculate/persist a demo order |
| Payment webhook endpoint | Whop, in the intended live design | **Not implemented** |

In production, management requires administrator authentication. In an unconfigured development environment, the app is an **open, shared demo**; this is not a place for customer information or real credentials. Public checkout responses exclude saved provider account identifiers and credentials.

## System components

| Component | Implementation | Responsibility |
| --- | --- | --- |
| Web application | Next.js 16, React 19, TypeScript; Node.js 24 | Dashboard, checkout, server API routes |
| Persistence | SQLite through `node:sqlite`, WAL mode | Brand records, products, orders, activity, encrypted credentials, demo-order idempotency |
| Validation | Zod schemas | Accept only bounded, supported fields; reject client-supplied prices and status injection |
| Authentication | Password/hash and signed HttpOnly session cookie | Restrict owner operations outside demo mode |
| Credential storage | AES-256-GCM | Encrypt provider credentials with brand/provider context |
| Shopify adapter | GraphQL Admin API 2026-07 | Verify store/domain/scopes/USD currency and import up to 2,000 active product variants |
| Whop adapter | Company retrieval API | Verify the API credential can read the requested `biz_…` business |
| Automated checks | Node test runner through `tsx`, TypeScript, Next build | Exercise persistence, authorization, provider validation, pricing, and account management |

### Source map

- `components/dashboard.tsx`: workspace navigation, brands, orders, studio, connection forms.
- `components/account-details.tsx`: editable non-secret domains and business identifiers.
- `components/checkout-settings.tsx`: configurable checkout presentation and optional offers.
- `components/checkout.tsx`, `app/checkout.css`: shared preview blocks and customer-facing demo checkout.
- `lib/accounts.ts`, `lib/checkout.ts`, `lib/types.ts`: defaults, shared pricing calculations, and data contracts.
- `lib/server/api.ts`: route orchestration, access checks, and public-data sanitization.
- `lib/server/store.ts`: SQLite persistence and transactional demo ordering.
- `lib/server/providers.ts`: Shopify/Whop API adapters.
- `lib/server/security.ts`, `validation.ts`, `http.ts`: authentication, encryption, origin validation, limits, and errors.
- `tests/`: automated regression coverage.

## Brand onboarding: what works now

1. **Add a brand.** Save its name, category, public storefront domain, Shopify API domain, and Whop business ID. A new brand has no products and starts as a demo draft.
2. **Save account details.** Under Connections, retain known Shopify aliases, storefront aliases, and a customer-account domain. These references are not proof of ownership or API access. Leave an ambiguous Shopify API domain blank until confirmed.
3. **Configure private deployment security.** Set administrator authentication, session signing, credential encryption, an HTTPS application origin, and a persistent database path.
4. **Verify API access.** Enter credentials through the protected connection form. Shopify must return the expected domain, USD currency, and required catalog/inventory scopes. Whop must return the expected business ID. Failed verification does not replace a working credential.
5. **Import products.** Shopify catalog synchronization stores a snapshot of active variants. A failed import preserves the old catalog; reconnecting Shopify clears it and returns the checkout to draft.
6. **Customize and test.** Edit checkout content, optionally add demo-only products, and publish a no-charge test checkout. Real publishing remains blocked.

Saved IDs prefill connection forms. Changing an already verified account requires successful verification of the replacement; editing a label cannot silently associate an existing credential with a different account. Manual token entry is implemented; automatic Shopify installation/OAuth and token refresh are not.

## Checkout: working demo flow

```text
Brand checkout page
  → GET /api/checkout/:slug
  → sanitized brand + available products
  → shopper selects quantity and optional extras
  → POST /api/checkout/:slug with product IDs, quantities, customer, options
  → server validates availability and computes all amounts in cents
  → transaction saves demo order + idempotency result
  → browser displays the server-confirmed order ID and total
```

Discounts apply to merchandise. Free-shipping eligibility and tips use the discounted merchandise subtotal. Shipping and priority fees are excluded from tips. Product add-ons are real validated cart line items, not a client-supplied surcharge. Extras are never preselected. A configured discount deadline expires on the server and does not restart when the page reloads.

Important limitations:

- No card details are collected. Wallet buttons and card logos are explicitly labeled design previews.
- A demo order with `status: paid` is a simulated completion, not a captured payment. Nothing is sent for fulfillment.
- Taxes are not calculated. Flat-rate shipping and the free-shipping threshold are demo settings, **not imported Shopify shipping rules**.
- Shipping addresses are validated but not retained for fulfillment in this version.
- Catalog availability is a snapshot, not a stock reservation or real-time guarantee.
- Unconfirmed testimonials are labeled as sample content. Merchant-confirmed reviews are not automatically verified purchases.
- Subscriptions, recurring billing, gift cards, and automatic Shopify discount parity are not implemented.
- The demo selects products inside Limitless; a Shopify storefront cart handoff is not implemented.

## Intended live workflow — design target, not implemented

```text
Shopify storefront and cart
  → supported cart handoff to checkout.brand.example
  → Limitless resolves the registered domain to the correct brand
  → backend validates cart, destination, availability, and final quote
  → backend creates an eligible Whop payment session for that brand's business
  → supported Whop payment component inside the Limitless page
  → Whop sends an authenticated payment event to the backend
  → backend durably records and reconciles the payment
  → idempotent Shopify order creation / reconciliation
  → Shopify remains the operational system for fulfillment
  → Limitless shows payment, order-sync, and exception status
```

This architecture is conditional on a supported Shopify/Whop integration for the merchant's products and territories. Provider account setup or a successful read-access check does not establish payment permission, policy approval, supported physical-product fulfillment, or access to Shopify's complete checkout calculations.

### Responsibilities in the intended live system

**Shopify:** source of truth for products, variants, inventory, markets, configured shipping/tax rules, and order/fulfillment operations. These should not be manually recreated in Limitless. The API mechanism for obtaining and honoring the actual shipping, tax, market, and discount calculations must be verified before committing to an external payment flow.

**Limitless:** own the branded page, securely map each brand to its provider account, obtain a server-authoritative quote, orchestrate payment and order synchronization, and surface failures. It must not accept arbitrary prices, trust an unregistered hostname, or mark an order paid based only on a browser redirect.

**Whop:** handle the supported payment collection flow under the merchant's existing business. Exact embedded checkout capabilities, payment methods, address/tax responsibilities, and payment authorization/capture behavior still need validation. Wallet or bank authentication may temporarily leave the brand page.

### Physical and personalized products

The live flow must preserve required variant selections, shipping information, and order-line metadata. Personalized face-print products additionally need supported transfer of personalization choices and private artwork/upload references into the Shopify order. That behavior is not represented by the current demo cart and must be designed and tested; product catalog images are not customer artwork.

### Reliable payment-to-order synchronization

Before launch, the backend needs signature verification over the provider's required raw webhook payload, replay protection, unique provider event/payment keys, durable processing state, retries, and reconciliation. A delayed or duplicated webhook must not create another Shopify order. A successful payment followed by a failed Shopify write must remain visible as an unresolved exception, not disappear or invite a second payment. Refunds, disputes, cancellations, inventory races, and the recovery/refund path need explicit handling and tests.

## Domains and hosting

The agreed approach is a **brand checkout subdomain**, such as `checkout.brand.example`, pointing to Limitless. Main storefronts remain on Shopify. A separate private dashboard address is proposed.

Currently, routing is path-based (`/checkout/:slug`) on the development Preview. Custom-domain-to-brand routing, domain ownership verification, TLS provisioning, and a separate admin hostname are **not implemented**. The security layer currently expects one exact production `APP_URL` origin. Supporting multiple checkout hosts requires explicit registered-host/origin validation and correct admin-cookie isolation—not disabling origin checks or accepting arbitrary forwarded hosts.

Whop may serve its payment component, but Limitless still needs a running application/backend for the custom page, secret-bearing provider requests, and payment events. The development Preview and a GitHub repository are not production hosting.

For the current SQLite architecture, a paid single-instance web service with a persistent disk is a practical initial private deployment. Do not place this database on ephemeral storage or scale to independent replicas. Before handling real orders, implement consistent database backups, test restoration, add monitoring and trusted edge rate limiting, and evaluate availability requirements. Durable webhook processing and/or migration to a managed database may be needed as the live design is finalized.

## Data and publication boundaries

- Source code, generic example configuration, tests, and synthetic seed assets belong in Git.
- Merchant domain mappings, Whop business IDs, orders, and encrypted provider credentials are workspace/database records. They are not hard-coded into this repository.
- `data/`, `.env` files other than `.env.example`, dependencies, build outputs, and private screenshots/recordings are ignored.
- A fresh deployment seeds the three synthetic example brands; it does **not** automatically contain the owner's configured brands.
- Migrate real workspace records privately with a consistent SQLite backup. Preserve the credential-encryption key separately if encrypted credentials are migrated. Never commit a database export or key to move environments.
- Publishing code is separate from deployment, domain setup, provider authentication, and approval to process live transactions.

## Launch gates

| Gate | Current position |
| --- | --- |
| Dashboard, account management, branded design | Implemented |
| No-charge ordering and configurable demo extras | Implemented and regression-tested |
| Provider read-access verification and catalog import | Implemented; real account credentials still needed for deployment verification |
| Supported Shopify/Whop physical-product architecture | Unconfirmed; must be resolved before live implementation is finalized |
| Shopify cart handoff, personalization, live totals and inventory handling | Not implemented |
| Whop payment session creation and embedded live collection | Not implemented |
| Signed webhooks, reliable Shopify order writes, recovery/refunds | Not implemented |
| Production deployment, backups, monitoring, checkout-domain routing | Not configured/implemented end to end |
| Authorized test transactions and real purchase/refund acceptance | Not performed |

Do not replace `environment.liveEnabled = false` until these gates are backed by actual checks and evidence. Domain names, saved business IDs, a successful build, or a repository publication are not launch-readiness signals.

## Verification and next steps

Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` with Node.js 24. The current automated suite covers 26 tests. Browser checks have exercised account creation/editing, invalid-ID feedback, saved provider prefills, disabled credential entry in demo, desktop/mobile checkout, an itemized demo purchase, and discount expiration without countdown resets. This evidence is for the implemented demo and account-management behavior, not real payments.

Next engineering priority: confirm the supported physical-product/payment-to-Shopify architecture, including personalization and shipping/tax calculations. Then implement and test the live flow, prepare the secure deployment, migrate data privately, connect actual accounts, and configure verified checkout domains. Obtain explicit approval before any real charge/refund test.
