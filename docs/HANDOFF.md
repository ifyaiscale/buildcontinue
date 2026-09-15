# Limitless Checkout — current handoff

Last updated: 2026-09-14.

## Current production state

Production branch: `hoplite/beroia-65b17429`.

Netlify project: `limitlesscheckout`. Production auto-deploy is active from the production branch. Commit `3330e060fc208b4832858ddd7a322e770194471b` built and published successfully; the subsequent FaceJamas controlled-acceptance UI patch `e5064c5299c49fb58cda2d6b99ef846d741fc7d5` is expected to auto-deploy next and must be confirmed `ready` before calling that patch live.

Controlled payment acceptance is enabled with `PAYMENT_ACCEPTANCE_ENABLED=true`. **Public customer charging remains OFF** with `PUBLIC_PAYMENT_ENABLED=false`. Do not enable public payment until the per-brand signed webhook, policy approval and controlled real-purchase acceptance gates are complete.

Production environment hardening completed on 2026-09-14:

- Replaced the plaintext administrator password variable with a one-way `ADMIN_PASSWORD_HASH`; the user's password itself did not change.
- Rotated `SESSION_SECRET`, intentionally invalidating old administrator sessions.
- Re-stored `CREDENTIAL_ENCRYPTION_KEY` and `DATABASE_URL` as secret environment variables without changing their values, preserving existing encrypted provider connections.
- Configured FaceJamas `SUPABASE_PUBLIC_ANON_KEY` and `FACEJAMAS_ASSET_URL` for private fulfillment media access.

## Completed application work

- Encrypted storefront cart handoff using Shopify variant IDs and quantities.
- Server-authoritative Shopify quote, destination tax and USD total.
- Exact-value Whop payment flow with embedded shopper checkout fields on the branded checkout domain.
- Whop card/CVV collection stays inside Whop's payment iframe and never passes through Limitless application code.
- Embedded Whop sessions refresh before expiry instead of leaving shoppers with a stale payment frame.
- Durable payment attempts, idempotency and retry/recovery workers.
- Signed, replay-window-protected Whop webhook verification and idempotent webhook ingestion.
- Exactly-once Shopify order completion protections.
- Branded checkout origin routing for:
  - `https://checkout.chefings.com`
  - `https://checkout.cozyinfants.com`
  - `https://checkout.facejamas.com`
- FaceJamas private personalization upload, proof verification, order binding, 90-day ordered-source retention and private fulfillment artwork access.
- Launch Center, versioned customer policies and controlled activation checks.
- Administrator pricing/payment diagnostic supports controlled purchases; FaceJamas now carries the required `pers_…` personalization reference through its controlled payment test.
- One-click Whop webhook provisioning page at `/launch-center/webhooks`. It creates a brand-specific `payment.succeeded` v1 webhook through Whop, captures the one-time signing secret immediately and stores it encrypted with the existing Whop credential.
- Three brand storefront designs and Shopify OS 2.0 release packages prepared outside the repository for upload to each corresponding Shopify store.

## Brand/provider state

All three brands remain `draft / demo` for safety.

- CHEFINGS: Shopify verified, Whop verified, 2 synced variants.
- COZYINFANTS: Shopify verified, Whop verified, 5 synced variants; priority processing is owned by Limitless as a once-per-order option rather than a storefront cart line.
- FACEJAMAS: Shopify verified, Whop verified, 3 synced variants; private personalization workflow and fulfillment access are implemented.

One encrypted Shopify credential record and one encrypted Whop credential record exist for each brand. At the time of this handoff refresh, the existing Whop credentials did not yet contain webhook signing secrets; use `/launch-center/webhooks` and **Provision all three** after the latest deploy is live. The connected Whop API keys need `developer:manage_webhook`; the setup UI fails closed with a specific error if a key lacks that permission.

Support contacts are configured as `support@chefings.com`, `support@cozyinfants.com`, and `support@facejamas.com`. The owner must confirm those inboxes are actually monitored before approving launch policy.

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

Whop provider callbacks use the administrator origin, not the checkout hosts:

- `/api/webhooks/whop/chefings`
- `/api/webhooks/whop/cozyinfants`
- `/api/webhooks/whop/facejamas`

The webhook provisioning endpoint derives the full HTTPS callback from `APP_URL` and does not expose the signing secret to the browser.

## Fixed launch policy

- Currency: USD.
- Launch countries: US, Canada, UK, New Zealand and Australia.
- Standard shipping: free.
- Optional priority processing: $4.99 USD once per order, unchecked by default.
- Browser prices, shipping, tax and totals are never authoritative.
- Public checkout payment requires both payment gates plus a brand already activated `live / live`.

## Remaining launch actions — ordered

1. Confirm Netlify production reports commit `e5064c5299c49fb58cda2d6b99ef846d741fc7d5` or later as `ready`.
2. Sign in again if required after the session-secret rotation, open `/launch-center/webhooks`, and choose **Provision all three**. Resolve any brand-specific Whop key permission error before continuing.
3. Return to Launch Center and confirm all three support inboxes are monitored.
4. Owner reviews and explicitly approves each brand's current shipping/returns/privacy/product-specific policy. Do not auto-approve these commitments.
5. For each brand, use its admin **Check checkout total** panel with a representative launch address and available product; verify the Shopify-authoritative USD total.
6. With explicit authorization, run one controlled real purchase per brand. FaceJamas must use a real private upload reference so the acceptance test exercises artwork binding.
7. Verify the signed Whop callback, completed Limitless attempt, exactly one Shopify order and, for FaceJamas, private fulfillment artwork binding. Record the completed `attempt_…` in Launch Center.
8. After all three controlled acceptance records are current, set `PUBLIC_PAYMENT_ENABLED=true` and allow the resulting production redeploy to finish.
9. Activate each brand in Launch Center. Because brands stay `draft / demo` until activation, setting the public gate alone does not expose a draft brand to customer payment.
10. Publish/confirm each prepared Shopify OS 2.0 storefront theme and final production media, then run a final shopper cart → branded checkout smoke test on each main domain.

## Checkout host and customer white-labeling

- Netlify HTTPS certificate coverage was established for all three `checkout.*` domains.
- Production host routing includes safe built-in defaults for the three fixed branded checkout domains while unknown hosts continue to fail closed.
- Customer-visible `Limitless Checkout` branding was removed from the branded checkout experience.
- Browser titles are brand-specific and the checkout footer does not show a Limitless attribution.

## FaceJamas private media

The Supabase project contains active `facejamas-upload` and `facejamas-asset` Edge Functions and the current public receipt/access tables. The live receipt schema includes `order_bound_at` and `source_deleted_at`, matching the 90-day ordered-source cleanup code. The upload function creates the private `personalization-assets` bucket on the first valid upload with a 10 MB limit and JPEG/PNG/WebP-only MIME restrictions, so an empty bucket list before the first upload is expected rather than a launch failure.

## Definition of done

A customer can start on a Shopify-hosted brand storefront, pass a server-authenticated cart to the matching branded Limitless checkout, review an authoritative Shopify-calculated USD total, pay exactly that amount through Whop, and receive confirmation only after exactly one corresponding Shopify order exists with all required fulfillment data. Retries and duplicate notifications must never create duplicate orders or ask a paid customer to pay again.
