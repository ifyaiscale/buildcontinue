# FaceJamas personalization architecture

FaceJamas customer artwork must survive storefront → checkout → payment → Shopify fulfillment without exposing raw customer images in public URLs, cart tokens, Whop metadata, or client-trusted pricing.

## Active flow

1. The FaceJamas storefront lets the customer select JPEG/PNG/WebP up to 10 MB and previews it with a local browser object URL.
2. After the customer confirms they have permission to use the image, the browser uploads directly to the JWT-protected `facejamas-upload` Supabase Edge Function using the project's public anon credential. The function independently enforces the allowed storefront origins.
3. `facejamas-upload` verifies the actual file signature, size and content type, applies a per-IP success rate limit, stores the source in the private `personalization-assets` bucket, and creates an opaque `pers_<uuid>` reference.
4. The upload function returns the opaque reference plus a random proof. Only SHA-256 of that proof is stored in the RLS-protected `public.facejamas_upload_receipts` table.
5. The storefront cart carries `{ personalizationRef, personalizationProof }` only long enough to enter Limitless. Raw image bytes and the private object path never enter the cart.
6. At `/cart/start/facejamas`, Limitless verifies SHA-256 of the proof against the private receipt over its server database connection. The proof is then discarded. The encrypted 30-minute cart token carries only `personalizationRef`.
7. Every FaceJamas merchandise line must have a verified personalization ID. Non-FaceJamas brands reject personalization data.
8. The authoritative Shopify quote sends `Personalization ID = pers_<uuid>` as a line custom attribute. Shopify's calculated draft must echo the exact variant, quantity and personalization attribute or payment is blocked.
9. Before Shopify draft or Whop side effects, the personalization receipt is claimed by the immutable Limitless payment attempt. A different attempt cannot reuse it.
10. On successful paid Shopify draft completion, Limitless binds the same personalization to the final Shopify order ID before the payment attempt can be marked completed.
11. Private fulfillment is available at `/facejamas-fulfillment` in the authenticated Limitless admin. Only order-bound personalization IDs are listed.
12. Clicking **Open artwork** creates a one-time access capability in `public.facejamas_asset_access`. The JWT-protected `facejamas-asset` Edge Function consumes it and returns a five-minute signed private Storage URL. There is no permanent public source-image link.

## Privacy and abuse controls

- Private Supabase Storage bucket; no public customer-photo URLs.
- Public browser credential is the Supabase anon/publishable credential only. Service-role credentials never enter Netlify storefront JavaScript.
- `facejamas-upload` is JWT-protected and separately checks the storefront Origin.
- JPEG/PNG/WebP only, max 10 MB, with file-signature validation in addition to MIME validation.
- Customer permission/rights confirmation is required before upload.
- Maximum 20 successful uploads per hashed client IP per hour; old rate events are cleaned up.
- Upload receipt proof is random and stored only as SHA-256 server-side.
- Raw proof is discarded after cart-start verification; encrypted checkout token contains only the opaque `pers_…` ID.
- Whop metadata never contains the image, object path or proof.
- Shopify receives only the fulfillment-safe `Personalization ID` line attribute.
- An artwork ID is reserved to one immutable payment attempt and one final Shopify order.
- Fulfillment source-image links are generated only for authenticated admin users, are one-time capability based, and expire after five minutes.
- Expired **unclaimed** uploads are deleted opportunistically from private Storage by the upload service. Attempt-bound or order-bound artwork is never removed by this orphan cleanup.
- This feature does not enable customer payments by itself. `PAYMENT_ACCEPTANCE_ENABLED` and `PUBLIC_PAYMENT_ENABLED` remain separate launch gates.

## Customer-facing representation

The browser preview confirms which source photo was selected. It is intentionally labeled illustrative and must not be represented as an exact manufactured garment render unless a verified production mockup renderer is later introduced.

## Operations

- Fulfillment page: `/facejamas-fulfillment`
- Upload function: `facejamas-upload`
- Fulfillment source function: `facejamas-asset`
- Private bucket: `personalization-assets`
- Authoritative receipt/order binding: `public.facejamas_upload_receipts`
- One-time fulfillment access: `public.facejamas_asset_access`

Ordered artwork retention after fulfillment should be set as an explicit business/privacy policy before broad public launch. The current automatic cleanup intentionally removes only abandoned, expired, unclaimed uploads because it does not yet know when a fulfilled personalized order is safe to purge.