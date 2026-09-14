# Store launch policies and customer-care controls

These policies are operational launch defaults for CHEFINGS, COZYINFANTS and FACEJAMAS. They are not auto-approved by code. The authenticated owner must review and explicitly approve the current version in `/launch-center` before a controlled acceptance can be recorded or a brand can become live.

Changing the monitored support email, launch-critical checkout wording, provider accounts, catalog, storefront domain, shipping policy or other fingerprinted state invalidates current launch acceptance where applicable.

## Shared checkout and shipping policy

- Currency: USD.
- Standard shipping: free under the current launch policy.
- Optional priority processing: $4.99 once per order, unchecked by default.
- Priority processing is not represented as faster carrier service and does not guarantee a delivery date.
- Shopify remains authoritative for current product availability, destination tax and the final order total.
- Browser display prices and subtotals are informational only.
- Payment-card entry is hosted by Whop; storefronts/Limitless do not collect card numbers.
- Public payment requires both payment environment gates, a live brand, verified providers, the current policy approval and a controlled completed acceptance purchase.

## CHEFINGS returns and product claims

Proposed/current launch return commitment:

> Eligible non-personalized items may be requested for return within 30 days of delivery if unused and in their original condition. Damaged, defective, or incorrect items should be reported promptly so the order can be reviewed and corrected.

Cancellation is not guaranteed after fulfillment or production has started.

Do not publish unverified claims about ingredient compatibility, dishwasher safety, blade specifications, material composition, battery/power characteristics, certifications, or cleaning/disassembly. Those statements must match the final manufactured unit and instructions.

## COZYINFANTS returns and product positioning

Proposed/current launch return commitment:

> Eligible non-personalized items may be requested for return within 30 days of delivery if unused and in their original condition. Damaged, defective, or incorrect items should be reported promptly so the order can be reviewed and corrected.

Cancellation is not guaranteed after fulfillment or production has started.

Cuddle Bears are positioned as supervised comfort companions. Do not claim that they diagnose, treat or cure anxiety, and do not position them as infant sleep products. Final age, battery, care and safety instructions must match the shipped product and packaging.

## FACEJAMAS personalized-order policy

Proposed/current launch return commitment:

> Because FaceJamas products are made from customer-supplied personalization, personalized items are final sale except where the item arrives damaged, defective, incorrect, or with a verified production error.

Personalized-order cancellation is not guaranteed once production has started.

The browser preview confirms the customer's selected source photo only. It is not represented as an exact manufactured print-placement render unless a verified production renderer is later introduced.

The customer must confirm they have permission to use the uploaded image for a personalized product.

## FaceJamas source-photo privacy and retention

- JPEG/PNG/WebP only, maximum 10 MB.
- Source photos are stored in a private Supabase Storage bucket.
- Raw image bytes and private bucket paths are not placed in public cart/payment URLs or Whop metadata.
- The storefront receives an opaque `pers_…` ID plus a random proof; only SHA-256 of that proof is stored server-side.
- The proof is verified at cart start and then discarded; the encrypted cart keeps only the opaque ID.
- Shopify receives `Personalization ID` as fulfillment-safe line metadata.
- A personalization ID is reserved to one immutable payment attempt and then one completed Shopify order.
- Abandoned unclaimed source uploads are deleted after the 30-day upload receipt window expires.
- Ordered source artwork is retained for fulfillment/replacement support for 90 days after order binding. The private source file is then deleted while non-image order/audit metadata may remain.
- Authenticated fulfillment access uses a one-time server capability and a five-minute signed source-image URL from `/facejamas-fulfillment`.

## Support contact requirement

A brand cannot approve launch policy or become live without a real monitored support email saved on the brand. Do not invent addresses such as `support@brand.com` unless the mailbox has actually been created and is monitored.

At the time this control was added, CHEFINGS, COZYINFANTS and FACEJAMAS all had blank support email fields. The owner must supply/establish the actual inbox(es) before live activation.

## Public policy pages

Each GitHub-controlled storefront has a `policies.html` page. It reads the current policy from Limitless at runtime so the support address and approved policy cannot drift from the launch record:

- `public/storefronts/chefings/policies.html`
- `public/storefronts/cozy-infants/policies.html`
- `public/storefronts/facejamas/policies.html`

The public endpoint reports whether the current policy is approved. Preview pages may display unapproved policy with an explicit preview warning; controlled live activation still remains blocked until approval.

## Owner launch sequence

1. Add final product photography/GIFs and verify every product claim against the actual shipped unit.
2. Configure a real monitored support inbox for each brand in `/launch-center`.
3. Read and explicitly approve each current customer policy in `/launch-center`.
4. Production-deploy the current verified Git commit after Netlify production deploys are restored.
5. Verify storefront domain/checkout cart handoff and authoritative Shopify quote with public payment still locked.
6. Verify Shopify, Whop and signed webhook readiness.
7. With explicit owner authorization, perform one controlled real acceptance purchase for the brand.
8. Verify signed callback, independent payment lookup, exact cents, exactly one paid Shopify order, and (for FaceJamas) exact order-bound personalization ID/private artwork access.
9. Record the completed immutable `attempt_…` ID in `/launch-center`.
10. Only after every readiness check is green, deliberately enable public payment and activate the brand live.
11. Validate cancel/failure/retry/duplicate-payment behavior and customer support operations before broad paid traffic.

A Netlify plan upgrade, a successful build, or a payment environment-variable change alone is never considered launch acceptance.