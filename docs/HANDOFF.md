# Limitless Checkout — current handoff

Last updated: 2026-09-10. Read this first when resuming work, then inspect the current checkout and live environment. Historical screenshots are not evidence of current state.

## Outcome and fixed decisions

- A **private, single-owner** dashboard for COZYINFANTS, CHEFINGS and FACEJAMAS, not a merchant subscription SaaS.
- Selected architecture: Shopify storefront/cart → brand-specific Limitless checkout → Whop payment → verified server notification → reliable Shopify order/fulfillment synchronization.
- Owner confirmed provider approval for the arrangement and physical-product businesses on 2026-09-10. This is owner confirmation, not independently performed account/payment verification.
- Launch destinations: US, Canada, UK (`GB`), New Zealand and Australia. **USD for display, quotes and payments in every country**. No automatic local-currency switching.
- Payment infrastructure comes before Shopify store design. Preserve FACEJAMAS personalization through eventual payment and fulfillment. COZYINFANTS redesign should retain its demonstrations/GIFs, box contents section and starry-galaxy concept; that redesign has not been recovered or implemented here.
- Guide the owner one step at a time. The owner uses Windows. Never ask for passwords/API keys in chat or screenshots; use protected connection forms or the platform's private Environment settings.
- Every completed shipment must be committed and pushed to GitHub, with this handoff updated. Never commit secrets, databases, customer data or private attachments.

## Implemented and published before this checkpoint

| Area | Current implementation |
| --- | --- |
| Dashboard | Brand management, account identifiers, settings, checkout editor, demo orders/activity, private sign-in |
| Checkout | Branded responsive no-charge demo with optional offers; exact server-side demo totals and idempotency |
| Connections | Encrypted per-brand credentials; Shopify identity/scopes/USD checks and catalog import; Whop company read verification |
| Host isolation | Registered checkout domains cannot access management APIs or other brands; exact-origin checks remain enforced |
| Pricing diagnostic | Admin-only `POST /api/brands/:id/payment-quote`; Shopify draft calculation without creating a draft/order or payment |
| Five-country scope | Shared UI/server country allowlist; country-specific diagnostic address validation; rejects non-USD rates/totals |
| Heading | Overview says “Your brands are growing.” |

Relevant earlier commits: `19fd46f` (host isolation), `3c88e80` (pricing diagnostic/plan), `40414ea` (five countries/USD), `8badb6e` (heading). Use Git history for the exact latest checkpoint rather than copying a potentially stale head SHA from a document.

## Current setup checkpoint: signing in, not account connection yet

1. The owner saved `ADMIN_PASSWORD`, `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` through Hoplite's private Environment settings. Presence/format checks passed without displaying values.
2. The already-running Next.js process retained its old demo environment. The saved values were applied to an owner-readable, **Git-ignored `.env.local`** file in this thread. Next.js reloaded it and showed the login form; unauthenticated `/api/state` returned 401.
3. The owner's first sign-in attempt failed with `Request origin must match the application origin`. Initially `APP_URL` was missing; setting it made a direct-listener check pass but **did not fix the owner's proxied request**. The owner reported the same failure afterward.
4. Routing-only diagnostics identified the Preview proxy rewriting `Origin`, `Host` and forwarded host/protocol to localhost/HTTP, without preserving the original origin. Diagnostics were removed; no password, cookie value or request body was logged. The proxy behavior was reported to Hoplite's developers.
5. A **development-only signed-CSRF adapter** now covers dashboard authentication/brand mutations. It requires exact `DEV_PROXY_ORIGIN=http://localhost:3000`, exact external HTTPS `APP_URL`, private authentication, an exact canonical client-origin header, and a valid cookie-matched proof bound to the public origin and current session. Anonymous proofs only permit login; production and checkout-host checks are unchanged. Both origin settings are applied in the Git-ignored runtime file. No wildcard/plain localhost allowlist was introduced.
6. Owner sign-in and the three real provider connections still need confirmation. The last inspected dashboard contained only the synthetic sample brands (Auré Studio, Form & Field, Everyday Supply) and eight sample orders. Do not claim the real brands or account records were migrated by pushing Git.

Prefer the **standalone Preview tab** for sign-in and account entry. Sessions use `HttpOnly; Secure; SameSite=Strict` when the configured application origin is HTTPS. An embedded cross-site Preview may not retain that cookie; do not weaken cookie protections to make an iframe work.

### Resuming or moving the environment

- `.env.local` is private runtime configuration, not a committed setup artifact. A fresh sandbox or deployment needs the private settings again. Store the current `APP_URL` and development-only `DEV_PROXY_ORIGIN` in the platform's Environment settings too if they should survive rebuilding this workspace. Production must instead use a correctly configured proxy; the adapter is always disabled there.
- A new Preview origin requires an updated `APP_URL`. Use the actual browser origin, not `localhost`, the Hoplite chat origin or a URL containing an authentication query string. Production proxies must preserve `Host`; the development proxy fallback is not permission to relax production isolation.
- If changing secrets in platform settings, reconcile the running process and private runtime file; a browser refresh alone does not reload stale server environment values. Never print the file contents or secret values while diagnosing.
- Back up the credential-encryption key separately using the owner's password manager. Replacing it without migrating credentials makes stored provider credentials unreadable.
- Existing `.hoplite/settings.json` and generated `next-env.d.ts` changes predate this checkpoint. Do not automatically stage them or `.hoplite/attachments/` with the next feature commit.
- The managed Preview tool previously required an optional `promote` object before any listener existed. The owner opened Preview from Hoplite successfully. Do not repeat failed promotion calls or invent a Stop/Restart button absent from the user's interface. Inspect live ports and the actual page.
- For this runtime, the actual Next.js listener is port 3000; the browser-facing local proxy was port 23000. That proxy rewrites `Origin`/`Host` to `http://localhost:3000`. **Verify both the direct listener and the rewriting proxy**, including browser-managed cookies. A direct-listener success alone missed this incident. Never add localhost to the allowed external origins without the signed proof requirements.
- The adapter deliberately excludes public checkout submissions. Five-country demo checkout browser acceptance is still pending; test checkout on an origin-preserving path rather than weakening its host isolation to make it run through the rewriting proxy.

## Next actions, in order

1. **Owner signs in in the standalone HTTPS Preview.** Confirm the dashboard shows private access and credential readiness. If origin errors persist, compare the configured origin against the actual browser origin without recording passwords or cookies.
2. **Create/select each real brand.** Avoid duplicates. Keep account mapping separate for COZYINFANTS, CHEFINGS and FACEJAMAS. Do not delete sample records or overwrite an earlier private database without explicit confirmation.
3. **Connect Shopify for each brand.** In Connections, use its permanent `.myshopify.com` domain and current supported app/token flow. Verify `read_products`/`read_inventory`, import products, and grant `write_draft_orders` for pricing diagnostics. Check current provider documentation before guiding app creation/token expiry; OAuth/refresh is not implemented.
4. **Connect Whop for each brand.** Enter that brand's company ID and API key only in the protected form. Verification is company read access, not proof of payment creation or webhook delivery. Do not invent a webhook URL before implementing the receiver.
5. **Pricing acceptance.** Compare representative carts, shipping, tax and applicable cross-border duties across all five countries in USD against the actual Shopify stores. Current automated provider tests are synthetic. No-rate, warning, unsupported currency, bundle and changed-cart responses remain blocked.
6. **Implement live payment lifecycle.** Durable immutable quotes/attempts; Shopify draft inventory reservations; actual Whop sessions; raw-body signed webhook inbox; authoritative payment lookup; event/payment deduplication; one fulfillment result per quote; retry/reconciliation and paid-but-unsynced visibility. Never blindly create another order after a timeout or silently ignore a second successful payment.
7. **Finish personalization and operations.** Private artwork storage and fulfillment references, refunds/disputes, monitoring, restore-tested backups and durable workers. Then deploy, configure DNS/HTTPS and validate callbacks. No hosting purchase or finished theme is needed for local implementation.
8. **Explicitly authorized acceptance transactions**, then store design. Owner provider approval is not authorization to make an unannounced real charge/refund.

## Verification and unresolved boundaries

- The five-country milestone passed 49 tests, TypeScript and the production build. The heading was verified in the running browser.
- This checkpoint adds a regression for HTTPS development Preview login through an HTTP proxy: exact configured origin accepted, wrong/cross-site origins rejected, secure strict-session cookie issued, and production unknown-host rejection preserved.
- Current checkpoint verification: **59 tests passed**, TypeScript passed and production build passed. Tests ran with private security variables and `DEV_PROXY_ORIGIN` unset; synthetic fixtures cover successful login, session-bound proof refresh, logout, authenticated brand creation, live-publish refusal, malicious/expired proofs, cross-site/checkout isolation and production-disabled fallback. Client tests cover concurrent challenges, fresh proofs after session changes and fail-closed requests.
- Fresh browser verification through the **rewriting proxy** confirmed the protected login form renders; the signed proof and browser-managed cookie reached password verification (401 for an intentionally wrong synthetic password); missing proof/wrong public origin returned 403; anonymous dashboard access returned 401. The check supplied the canonical public-origin header explicitly because the agent browser was on the local proxy address. This verifies the proxy/cookie protocol, not a completed owner-browser sign-in. No actual owner password was used.
- Before `APP_URL` was configured, browser inspection confirmed private sign-in rendering, `configured: true`, `demo: false`, and anonymous dashboard rejection. The external Preview is protected by Hoplite authentication, so the agent's separate browser may be redirected to Hoplite login; never bypass that protection or claim it is owner-browser sign-in proof.
- **Not implemented:** live payment sessions, signed payment webhooks, Shopify order writes/recovery, full shopper cart handoff, production shipping/tax parity, personalization, refunds/disputes and production operational readiness. `environment.liveEnabled` remains hard-disabled.

For the detailed implementation sequence and source references, see [PAYMENT_IMPLEMENTATION_PLAN.md](PAYMENT_IMPLEMENTATION_PLAN.md), [PAYMENT_ARCHITECTURE.md](PAYMENT_ARCHITECTURE.md) and [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md).
