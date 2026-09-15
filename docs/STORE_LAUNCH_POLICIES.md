# Store launch policies and customer-care controls

These are the launch-policy defaults for CHEFINGS, COZYINFANTS and FACEJAMAS. They are written to match the actual checkout/fulfillment architecture rather than promise delivery times, product capabilities, or refund outcomes the stores cannot reliably guarantee.

Policy version: **2**.

Customer charging remains disabled until controlled acceptance succeeds and public payments are explicitly enabled.

## Shared checkout, payment and shipping policy

- Currency: USD.
- Launch countries: United States, Canada, United Kingdom, New Zealand and Australia.
- Standard shipping: free on every launch order.
- Optional priority processing: $4.99 once per order, unchecked by default.
- Priority processing moves the order into the priority-processing workflow. It is **not** an upgraded carrier service and does not guarantee a delivery date.
- Delivery estimates are not guarantees and may vary because of destination, fulfillment timing, carrier conditions, customs or other circumstances outside the store's control.
- Shopify remains authoritative for product availability, destination tax and the final USD order total.
- Payment-card entry is hosted by Whop. Raw card numbers/CVV are not collected by the brand storefronts or Limitless Checkout.
- Customer/order information may be used to process the purchase, provide support, prevent fraud and fulfill the order.

## Returns, refunds and cancellations — CHEFINGS / COZYINFANTS

Eligible non-personalized items may be requested for return within **30 days of delivery**. Returned items must be unused and in their original condition. Customers should contact the brand's support inbox before sending a return.

Damaged, defective or incorrect items will be reviewed for replacement, correction or refund as appropriate. Approved refunds are issued to the original payment method after the return or reported issue has been reviewed. Optional priority-processing fees are not refundable after priority processing has begun.

Cancellation requests are accepted before fulfillment or production begins, but cancellation cannot be guaranteed once processing, fulfillment or production has started.

## CHEFINGS product claims

Do not publish unverified claims about ingredient compatibility, dishwasher safety, blade specifications, material composition, battery/power characteristics, certifications, cleaning or disassembly. Those statements must match the final manufactured unit and instructions.

## COZYINFANTS product positioning

Cuddle Bears are comfort products for supervised use. They are not marketed as medical treatment, anxiety treatment or infant sleep products. Final age guidance, care instructions, battery information, warnings and safety instructions must match the shipped product and packaging.

## FACEJAMAS personalized-order policy

Because FaceJamas products are made from customer-supplied personalization, personalized items are **final sale** except when the item arrives damaged, defective, incorrect or with a verified production error.

When a qualifying personalized-order issue is verified, FaceJamas may replace, correct or refund the affected item as appropriate. Optional priority-processing fees are not refundable after priority processing has begun.

Personalized-order cancellation requests are accepted before production begins, but cancellation cannot be guaranteed once production has started.

The browser preview confirms the customer's selected source image. Normal manufacturing variation in print placement or color may occur unless a specific production proof is expressly provided.

Customers must have permission to use the image they upload and must not upload content that infringes another person's rights.

## FaceJamas source-photo privacy and fulfillment

The personalization architecture deliberately keeps the customer's image out of public checkout/payment URLs while making it accessible to authorized fulfillment systems:

- JPEG/PNG/WebP only, maximum 10 MB.
- Source photos are stored privately in Supabase Storage.
- Raw image bytes and private storage paths are not placed in public cart, checkout, payment or Shopify image URLs.
- The storefront receives an opaque `pers_…` reference plus a random proof. Only the proof hash is stored server-side.
- The proof is verified when checkout starts and is not carried forward as a fulfillment credential.
- The encrypted checkout keeps only the opaque personalization reference.
- **Shopify receives `Personalization ID` as line-item metadata.** This is the fulfillment reference attached to the eventual Shopify order.
- The source image itself does **not** need to be embedded into the checkout page or copied into Shopify's public media system.
- A personalization reference is reserved to one payment attempt and then associated with the resulting Shopify order so exports/API consumers can match the order to its artwork.
- Authorized fulfillment staff or shipping/production agents can use the `Personalization ID` through private fulfillment tooling/API to obtain a short-lived signed artwork URL.
- Private artwork access must be authenticated and time-limited; a fulfillment provider should receive only the order/artwork access needed to manufacture or ship that customer's order.
- Abandoned unclaimed source uploads are deleted after the 30-day upload receipt window expires.
- Ordered source artwork is retained for fulfillment/replacement support for 90 days after association with the Shopify order, then the private source file is deleted while non-image order/audit metadata may remain.

This means a fulfillment workflow can be either:

1. export Shopify orders including `Personalization ID`, then resolve those IDs through the private fulfillment tool/API; or
2. have a shipping/production agent consume an authenticated fulfillment API that returns the Shopify order plus short-lived access to the matching artwork.

No public image embedding is required.

## Support contacts

Current configured brand support contacts:

- CHEFINGS — `support@chefings.com`
- COZYINFANTS — `support@cozyinfants.com`
- FACEJAMAS — `support@facejamas.com`

These inboxes should remain monitored while the brands are accepting orders.

## Public policy presentation

Customer-facing storefront/checkout policy pages should present the applicable shipping, return/refund/cancellation and privacy wording in plain language. The launch record hashes the current policy so a material policy change invalidates an older controlled-launch acceptance where appropriate.

## Controlled launch sequence

1. Keep public payment disabled.
2. Verify storefront cart handoff and authoritative Shopify quote for each brand without charging.
3. Verify Shopify, Whop and signed-webhook readiness.
4. Record the current policy approval for each brand.
5. With explicit owner authorization immediately before the charge, perform a controlled real acceptance purchase.
6. Verify Whop payment, signed callback, independent payment lookup, exact cents and exactly one Shopify order.
7. For FaceJamas, verify the Shopify line item contains `Personalization ID` and the private fulfillment service resolves that reference to the correct source artwork.
8. Verify retries/duplicate webhooks cannot create another Shopify order.
9. Only after controlled acceptance succeeds should public customer payment be deliberately enabled.

A successful deploy, connected provider account or webhook test by itself is not launch acceptance.
