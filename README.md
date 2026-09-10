# Limitless Checkout

A single-owner, multi-brand checkout workspace built with Next.js 16, React 19, TypeScript, and SQLite. Designed for organizing your Shopify stores and Whop companies in one place, with a branded checkout preview for each brand.

> **Current status: working management app and demo checkout, not live payment processing.** Publishing this code does not deploy the app, transfer private workspace data, or connect provider accounts.

## System overview

**Resuming work? Start with [the current handoff and next-step plan](docs/HANDOFF.md).** Update it with every completed shipment, then commit and push the code, tests and documentation together. Never publish runtime secrets or private workspace data.

Read the [system overview and intended live workflow](docs/SYSTEM_OVERVIEW.md) for the component breakdown, owner/customer journeys, Shopify and Whop responsibilities, checkout-subdomain plan, data boundaries, and launch gates.

The intended arrangement is Shopify storefronts → brand-specific Limitless checkout pages → supported Whop payment collection → reliable Shopify order synchronization. The custom checkout design and domain-routing isolation exist; live payment collection, Shopify cart handoff/order writes, shopper-facing shipping/tax integration, personalized-product handling, and webhooks are still pending. Shopify should remain the source of truth for existing products, markets, shipping, and fulfillment—not require the owner to recreate those settings in Limitless.

See the [payment implementation plan](docs/PAYMENT_IMPLEMENTATION_PLAN.md) for the architecture, owner-confirmed provider approval, remaining technical acceptance gates, and the implemented **admin-only Shopify shipping/tax preflight**. Launch destinations are the US, Canada, UK, New Zealand and Australia; checkout and provider amounts must remain **USD** in every country. It calculates without creating a draft or charging a customer; it is not a payable quote or proof of Shopify Checkout parity.

## What works today

- Persistent brand creation, branding settings, dashboard order aggregates, and activity.
- A responsive checkout studio with live layout preview, editable brand colors and copy, and shipping settings. New brands can add manual **test products** through the studio, publish a demo, and place a no-charge order without provider credentials. `POST /api/brands/:id/products` accepts `{title, description, price}` only for demo brands.
- Three clearly synthetic sample brands: Auré Studio, Form & Field, and Everyday Supply. They start as **demo drafts**, with no connected accounts. Eight sample orders use `example.com` addresses and are labeled demo.
- Demo publishing and demo checkout: validates products, quantities and customer details, computes USD totals and shipping server-side, persists the order, and never charges a card. `status: paid` on a demo order means simulated completion, **not money collected**. Taxes are not calculated.
- Real server-to-server Shopify credential validation, scope/currency checks, and paginated product-variant import (up to 2,000 variants, USD only).
- Real Whop company API read-access validation. A verified connection proves the supplied credential could retrieve the selected account; it does **not** prove payment permission, underwriting approval, or webhook delivery.
- Admin login with signed, eight-hour HttpOnly cookies; same-origin JSON mutations; bounded inputs; process-local rate limits; AES-256-GCM credential encryption with brand/provider binding.

## Important: not a live payment processor

### Brand account details

Use **Connections → Edit account details** to save a brand’s primary storefront domain, Shopify API domain, known Shopify aliases, Whop business ID, storefront aliases, and customer-account domain. The add-brand wizard also accepts the primary storefront, Shopify domain, and Whop business ID. These are account references, not credentials, and can be prepared before private deployment is configured.

Storefront domains (for example `store.example`) are separate from the `.myshopify.com` domain used for Shopify Admin API calls. If multiple Shopify domains are known, keep them as aliases until the API domain is confirmed; saving an alias does not verify ownership. Whop business IDs use the `biz_…` format and are not API keys.

Saving identifiers leaves provider connections unverified and live checkout disabled. The protected connection form prefills these saved IDs and verifies the provider before storing encrypted credentials. Successful verification updates the saved account mapping. Changing an already verified account requires verifying the replacement through Connections; a metadata edit cannot relabel an existing credential as belonging to another account. Failed verification preserves the previous verified connection.

Saved account details are administrator workspace data and are omitted from public checkout responses. Actual merchant records stay in the private SQLite data directory, not in source code or seed fixtures. Moving the app to another deployment requires a secure migration of that database; publishing code alone does not transfer workspace records.

### Conversion-focused checkout design

The checkout uses a Shopify-style contact/delivery/payment layout with a compact order summary, per-brand colors, and optional conversion blocks. In **Checkout studio**, expand the settings below shipping and save to publish the content changes for that brand:

- **Trust & payment presentation:** demo-labeled wallet/card-method examples, checkout reassurance, merchant-written delivery/returns text, and expandable FAQs. Payment examples do not enable or promise any payment method.
- **Customer review:** configurable quote, author, and 1–5 stars. Unconfirmed content is labeled as a sample; merchant confirmation is not purchase verification. Editing the quote, author, or rating clears confirmation in the editor. No invented customer counts, aggregate ratings, or “verified buyer” badge are added.
- **Offers & order value:** one percentage discount code, an available catalog product as an optional order bump, optional priority processing, and optional tips. Nothing is preselected. Subscriptions and recurring billing remain unsupported.
- **Time-limited offer:** a fixed discount deadline tied to the configured code. The countdown never restarts on refresh. The server rejects the expired code; base product prices do not change.

The demo checkout request accepts optional `options: {discountCode, tipPercent, priority}`. Tip percentages are limited to 0, 5, 10, or 15. Bump products are ordinary validated cart line items, not client-supplied prices. The server computes everything in integer cents; discounts apply to merchandise, and both free-shipping eligibility and tips use the discounted merchandise subtotal. Shipping and priority fees are excluded from tips. The response and saved order include an itemized `breakdown` with subtotal, discount, shipping, priority, tip, and total. Retry idempotency includes the selected options.

These are familiar design patterns, not evidence of increased conversion. Review actual customer behavior and run controlled experiments before making performance claims.

`environment.liveEnabled` is always `false`. Every live-publish attempt is rejected with an actionable explanation. No card fields, payment capture, offsite-payment bypass, Shopify order writes, or payment webhooks are implemented. Do not route real shoppers here yet. There is no switch that turns an incomplete integration into live payments.

Same-day **demo setup and account verification** are possible if you have the required credentials. Same-day production launch is **not guaranteed** and depends on implementation, provider approvals, Shopify/Whop terms, your products, and your accounts.

## Run locally

Use **Node.js 24** (the backend uses `node:sqlite`):

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. With all authentication and encryption secrets unset, development is an openly accessible demo. Partially configured secrets fail closed instead of silently enabling public access. All visitors share the same database and can view/edit demo data; never enter customer details or secrets there. Credential submissions are rejected in unconfigured demo mode. Seed checkout paths are `/checkout/aure-studio`, `/checkout/form-and-field`, and `/checkout/everyday-supply`.

```sh
npm test
npm run typecheck
npm run build
```

## Secure deployment

This MVP is a **single-owner application**, not a multi-tenant SaaS. Deploy one Node.js server on HTTPS with a persistent private volume. Set `NODE_ENV=production`, `APP_URL` to the exact external origin (no path), and these secrets through your hosting secret manager:

1. `ADMIN_PASSWORD_HASH` (preferred) or a randomly generated `ADMIN_PASSWORD` of at least 16 characters.
2. `SESSION_SECRET`, independently generated, at least 32 characters.
3. `CREDENTIAL_ENCRYPTION_KEY`, exactly 64 hexadecimal characters (32 random bytes), before provider connections.
4. `DATABASE_PATH`, the private persistent SQLite path (default `data/limitless.sqlite`).

Generate a password hash locally, passing the password through an interactive prompt rather than putting it in shell history:

```sh
read -r -s -p 'Admin password: ' ADMIN_SECRET; echo
export ADMIN_SECRET
node -e 'const c=require("node:crypto");const s=c.randomBytes(16).toString("hex");console.log("scrypt:"+s+":"+c.scryptSync(process.env.ADMIN_SECRET,s,64).toString("hex"))'
unset ADMIN_SECRET
```

Generate independent secrets:

```sh
node -e 'console.log(require("node:crypto").randomBytes(48).toString("hex"))' # SESSION_SECRET
node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))' # CREDENTIAL_ENCRYPTION_KEY
```

Production management fails closed if authentication is missing. `APP_URL` is the exact HTTPS **admin** origin (no path or trailing slash). The reverse proxy must preserve the public `Host` header; arbitrary `X-Forwarded-Host` headers are not trusted. Unregistered production hosts are rejected, and mutations require an origin matching the specific requested host. Unauthenticated visitors can only see published demo checkouts, never draft checkouts or dashboard/customer data. Credentials are never returned in API JSON. Keep the encryption key backed up separately: replacing it makes existing saved credentials unreadable; reconnect accounts after deliberate rotation. Rotate `SESSION_SECRET` to invalidate all existing login sessions. Logout clears the current browser cookie; individual-session server-side revocation is not implemented.

### Brand checkout hosts

Register exact checkout origins and existing brand slugs in a private environment variable:

```sh
APP_URL=https://admin.example
CHECKOUT_ORIGINS='{"https://checkout.brand.example":"brand-slug"}'
```

Each mapped host serves its brand's checkout at `/` (or `/checkout/:slug`). Only that brand's `/api/checkout/:slug` endpoint is available on that host: other brands, login, and management APIs return 404. A valid admin cookie does not expose drafts there. Admin cookies remain host-only, and each checkout mutation must come from its own origin, not another registered checkout or the dashboard. Owner draft previews still work at `/checkout/:slug` on the admin origin. Invalid mappings fail closed; checkout hosts must differ from the admin host. Leave `CHECKOUT_ORIGINS={}` for the existing path-based development workflow.

This is application routing, **not automatic DNS, domain ownership verification, or certificate provisioning**. Before adding a real domain, verify ownership and configure its DNS/TLS with the eventual hosting provider. Do not point customer traffic here until the payment launch gates are complete. With SQLite, run one server instance and disable shared/proxy caching for checkout pages and APIs. The app's domain mappings are environment configuration; saved storefront/account aliases do not authorize hosts.

SQLite runs in WAL mode. Use a consistent SQLite backup, not a copy of just the main file while writes are running. The database includes customer names/emails entered during checkout and needs access controls, retention/deletion procedures, and encrypted backups. Shipping addresses are validated but not retained because this version does not fulfill orders. Delete the database **only for an intentional demo reset**, with the server stopped; it will reseed on next start. Do not use an ephemeral/serverless filesystem or multiple replicas with independent databases. The in-memory rate limiter is process-local and resets on restart: add trusted edge rate limiting before exposing a real deployment.

## Connect your stores

### Shopify

Create/install an app through the Shopify Dev Dashboard or Shopify CLI and obtain an Admin API access token using Shopify's supported token acquisition method. Existing admin-created custom-app tokens can work, but new admin-created custom apps are no longer available. This MVP accepts a token manually; OAuth installation, token acquisition/refresh, and automatic onboarding are not implemented. If your acquisition method issues expiring tokens, reconnect with a fresh token after expiry.

Enter the permanent `your-store.myshopify.com` hostname and token in the authenticated connection form. Required scopes: **`read_products` and `read_inventory`** (their write equivalents also satisfy validation). The adapter uses GraphQL Admin API **2026-07**, validates the returned store domain and **USD** store currency, and checks access scopes. Sync imports all active variants up to 2,000; an oversized/failed import keeps the old catalog intact. Reconnecting Shopify clears the catalog and returns the checkout to draft to avoid selling references from a different store. Import again before publishing. Imported availability is a snapshot, not a live inventory reservation.

Official references consulted:
- [Shopify token acquisition](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin)
- [Shop query](https://shopify.dev/docs/api/admin-graphql/latest/queries/shop)
- [2026-07 productVariants query](https://shopify.dev/docs/api/admin-graphql/2026-07/queries/productVariants)

### Whop

Use the intended company's `biz_…` ID and an API key authorized for **`company:basic:read`**. The backend calls `GET https://api.whop.com/api/v1/companies/{id}` with Bearer authentication and checks the returned ID before storing credentials. Each brand can retain its own company credential. The optional webhook secret is encrypted if supplied, but **no webhook endpoint or signature verification is implemented yet**. Never describe a successful read-access check as payment readiness.

- [Whop retrieve-company API](https://docs.whop.com/api-reference/companies/retrieve-company)
- [Whop API getting started](https://docs.whop.com/developer/api/getting-started)

## Required before taking real payments

1. Confirm with Shopify and Whop that your product types, territories, and intended checkout/payment flow are supported and compliant; complete Whop merchant/KYC/underwriting and payout setup. This app does not establish policy approval or permission to bypass Shopify checkout.
2. Implement an approved Whop checkout/payment flow with server-authoritative prices, explicit currency, customer consent, and verified payment success. Never mark an order paid from a browser redirect.
3. Implement signed, replay-protected Whop and Shopify webhooks, durable idempotency, retries, reconciliation, refunds, disputes, and payment/order failure recovery.
4. Implement authorized Shopify order creation and fulfillment reconciliation with required scopes and any protected-customer-data approvals. Guarantee one order per successful payment.
5. Add live inventory reservations/revalidation, shipping zones/rates, taxes, discounts, returns/privacy/terms/support policies, and correct address collection/retention.
6. Implement supported per-store onboarding/OAuth and expiring-token refresh, production access control/audit logging, monitoring, backup restoration, edge rate limits, and end-to-end test transactions.

Only then replace the explicit live-publish gate with verified readiness checks. Authentication alone is not a live-payment readiness signal.

## API summary

All responses are JSON; errors have `{ "error": "…" }`. Management routes require admin authentication except in the unconfigured development demo. Mutations require matching `Origin` and `Content-Type: application/json` headers. Totals are in USD major units and computed using integer cents.

| Route | Purpose |
| --- | --- |
| `GET /api/state` | Brands, orders, activity and environment flags |
| `POST /api/brands` | `{name, category, domain?, accent?, accountDetails?}` → new empty demo draft |
| `PATCH /api/brands/:id` | Validated name/category/domain/accent, checkoutTitle, announcement, supportEmail, shippingPrice, freeShippingThreshold, checkoutExperience, and accountDetails; no connection-status or credential assignment |
| `POST /api/brands/:id/connections` | `{provider:"shopify",domain,accessToken}` or `{provider:"whop",companyId,apiKey,webhookSecret?}`; authenticated secure deployments only |
| `POST /api/brands/:id/products/sync` | Read and replace Shopify catalog; authenticated secure deployments only |
| `POST /api/brands/:id/payment-quote` | Diagnostic USD Shopify draft calculation for US/CA/GB/NZ/AU with current shipping rates/taxes; requires protected admin access and `write_draft_orders`; never creates an order or enables payments |
| `POST /api/brands/:id/products` | `{title, description?, price}` → add a manual test product to a demo brand |
| `POST /api/brands/:id/publish` | `{mode:"demo"}`; requires an available product. `live` explicitly blocked |
| `GET /api/checkout/:slug` | Sanitized brand, no provider account identifiers; drafts need admin/demo access |
| `POST /api/checkout/:slug` | `{mode:"demo",items:[{productId,quantity}],customer:{email,firstName,lastName,address,city,postalCode,country},options?:{discountCode?,tipPercent?,priority?}}` → `{orderId,mode:"demo",total,breakdown}` |
| `GET /api/auth/status` | `{authenticated,configured,demo}` |
| `POST /api/auth/login` | `{password}`; rate-limited |
| `POST /api/auth/logout` | `{}`; clears cookie |

Checkout supports an optional `Idempotency-Key` header (8–100 alphanumeric/underscore/hyphen characters). Reusing a key with the same payload returns the original order; changing the payload returns 409. Duplicate product lines, unknown fields/client prices, invalid quantities, unavailable products, and invalid customer inputs are rejected. `freeShippingThreshold: 0` means all orders qualify for free shipping. Demo publication uses `status: "live", mode: "demo"`: the URL is published, **not live payments**.
