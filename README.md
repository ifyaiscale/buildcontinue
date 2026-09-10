# Limitless Checkout

A single-owner, multi-brand checkout workspace built with Next.js 16, React 19, TypeScript, and SQLite. Designed for organizing your Shopify stores and Whop companies in one place, with a branded checkout preview for each brand.

## What works today

- Persistent brand creation, branding settings, dashboard order aggregates, and activity.
- A responsive checkout studio with live layout preview, editable brand colors and copy, and shipping settings. New brands can add manual **test products** through the studio, publish a demo, and place a no-charge order without provider credentials. `POST /api/brands/:id/products` accepts `{title, description, price}` only for demo brands.
- Three clearly synthetic sample brands: Auré Studio, Form & Field, and Everyday Supply. They start as **demo drafts**, with no connected accounts. Eight sample orders use `example.com` addresses and are labeled demo.
- Demo publishing and demo checkout: validates products, quantities and customer details, computes USD totals and shipping server-side, persists the order, and never charges a card. `status: paid` on a demo order means simulated completion, **not money collected**. Taxes are not calculated.
- Real server-to-server Shopify credential validation, scope/currency checks, and paginated product-variant import (up to 2,000 variants, USD only).
- Real Whop company API read-access validation. A verified connection proves the supplied credential could retrieve the selected account; it does **not** prove payment permission, underwriting approval, or webhook delivery.
- Admin login with signed, eight-hour HttpOnly cookies; same-origin JSON mutations; bounded inputs; process-local rate limits; AES-256-GCM credential encryption with brand/provider binding.

## Important: not a live payment processor

`environment.liveEnabled` is always `false`. Every live-publish attempt is rejected with an actionable explanation. No card fields, payment capture, offsite-payment bypass, Shopify order writes, or payment webhooks are implemented. Do not route real shoppers here yet. There is no switch that turns an incomplete integration into live payments.

Same-day **demo setup and account verification** are possible if you have the required credentials. Same-day production launch is **not guaranteed** and depends on implementation, provider approvals, Shopify/Whop terms, your products, and your accounts.

## Run locally

Use **Node.js 24** (the backend uses `node:sqlite`):

```sh
npm install
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

Production management fails closed if authentication is missing. Production mutations require an HTTPS `APP_URL` with no path or trailing slash; the reverse proxy must preserve the public request origin. Unauthenticated visitors can only see published demo checkouts, never draft checkouts or dashboard/customer data. Credentials are never returned in API JSON. Keep the encryption key backed up separately: replacing it makes existing saved credentials unreadable; reconnect accounts after deliberate rotation. Rotate `SESSION_SECRET` to invalidate all existing login sessions. Logout clears the current browser cookie; individual-session server-side revocation is not implemented.

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
| `POST /api/brands` | `{name, category, domain, accent}` → new empty demo draft |
| `PATCH /api/brands/:id` | Name/category/domain/accent, checkoutTitle, announcement, supportEmail, shippingPrice, freeShippingThreshold only |
| `POST /api/brands/:id/connections` | `{provider:"shopify",domain,accessToken}` or `{provider:"whop",companyId,apiKey,webhookSecret?}`; authenticated secure deployments only |
| `POST /api/brands/:id/products/sync` | Read and replace Shopify catalog; authenticated secure deployments only |
| `POST /api/brands/:id/publish` | `{mode:"demo"}`; requires an available product. `live` explicitly blocked |
| `GET /api/checkout/:slug` | Sanitized brand, no provider account identifiers; drafts need admin/demo access |
| `POST /api/checkout/:slug` | `{mode:"demo",items:[{productId,quantity}],customer:{email,firstName,lastName,address,city,postalCode,country}}` → `{orderId,mode:"demo",total}` |
| `GET /api/auth/status` | `{authenticated,configured,demo}` |
| `POST /api/auth/login` | `{password}`; rate-limited |
| `POST /api/auth/logout` | `{}`; clears cookie |

Checkout supports an optional `Idempotency-Key` header (8–100 alphanumeric/underscore/hyphen characters). Reusing a key with the same payload returns the original order; changing the payload returns 409. Duplicate product lines, unknown fields/client prices, invalid quantities, unavailable products, and invalid customer inputs are rejected. `freeShippingThreshold: 0` means all orders qualify for free shipping. Demo publication uses `status: "live", mode: "demo"`: the URL is published, **not live payments**.
