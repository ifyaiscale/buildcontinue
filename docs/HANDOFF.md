# Limitless Checkout — current handoff

Last updated: 2026-09-14.

## Current production state

Production branch: `hoplite/beroia-65b17429`.

Latest merged application release before this handoff refresh: `8d75967f948cef6c849b6a9f0b4fb4d60b0ba3c8` — branded checkout subdomains and polished shopper checkout.

Netlify team has been upgraded from Free to Personal. The currently published production deploy still reports the older application commit `e0be107d1bdc2e2e72d887221b295461f13f1306`; do not claim the newer checkout is live until Netlify reports a ready production deploy at this handoff commit or a later commit containing `8d75967f…`.

Customer charging remains OFF. Do not enable public payment without explicit owner authorization and controlled acceptance.

## Completed application work

- Encrypted storefront cart handoff using Shopify variant IDs and quantities.
- Server-authoritative Shopify quote, destination tax and USD total.
- Exact-value Whop hosted payment flow with signed callback verification.
- Durable payment attempts, idempotency and retry/recovery workers.
- Exactly-once Shopify order completion protections.
- Branded checkout origin routing for:
  - `https://checkout.chefings.com`
  - `https://checkout.cozyinfants.com`
  - `https://checkout.facejamas.com`
- FaceJamas private personalization upload, proof verification, order binding and private fulfillment artwork access.
- Launch Center, versioned customer policies and controlled activation checks.
- Three brand storefront designs and Shopify OS 2.0 release packages prepared outside the repository for upload to each corresponding Shopify store.

## Brand/provider state

All three brands remain `draft / demo` for safety.

- CHEFINGS: Shopify verified, Whop verified, 2 synced variants.
- COZYINFANTS: Shopify verified, Whop verified, 5 synced variants; priority-processing product is not a cart line because Limitless owns the once-per-order option.
- FACEJAMAS: Shopify verified, Whop verified, 3 synced variants; private personalization workflow is implemented.

Support contacts are configured as `support@chefings.com`, `support@cozyinfants.com`, and `support@facejamas.com`, but inbox monitoring must be confirmed before policy approval.

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

## Fixed launch policy

- Currency: USD.
- Launch countries: US, Canada, UK, New Zealand, Australia.
- Standard shipping: free.
- Optional priority processing: $4.99 USD once per order, unchecked by default.
- Browser prices, shipping, tax and totals are never authoritative.

## Remaining launch actions — ordered

1. Publish a fresh Netlify production build and verify the deployed commit contains `8d75967f…` or later.
2. Add/verify the three `checkout.*` custom domains in Netlify and corresponding DNS CNAMEs; verify HTTPS.
3. Upload each prepared Shopify OS 2.0 theme to its matching Shopify store and preview before publishing.
4. Connect `facejamas.com` to the FaceJamas Shopify store; keep `checkout.facejamas.com` routed separately to Netlify.
5. Run no-charge cart → branded checkout → authoritative Shopify quote QA for all three brands.
6. Confirm all three support inboxes are monitored.
7. Owner reviews and explicitly approves current shipping/returns/privacy policies.
8. With explicit authorization, run controlled acceptance purchases and verify signed Whop callback, exactly one Shopify order, confirmation state and FaceJamas artwork fulfillment.
9. Only after acceptance succeeds, enable public payment and activate brands live.
10. Add final approved hero/product/GIF/review media last through Shopify Theme Editor.

## Definition of done

A customer can start on a Shopify-hosted brand storefront, pass a server-authenticated cart to the matching branded Limitless checkout, review an authoritative Shopify-calculated USD total, pay exactly that amount through Whop, and receive confirmation only after exactly one corresponding Shopify order exists with all required fulfillment data. Retries and duplicate notifications must never create duplicate orders or ask a paid customer to pay again.
