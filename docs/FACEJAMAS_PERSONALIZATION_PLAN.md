# FaceJamas personalization architecture

Customer artwork must survive storefront → checkout → payment → Shopify fulfillment without exposing raw customer images in public URLs, cart tokens, Whop metadata, or client-trusted pricing.

## Flow

1. FaceJamas storefront requests a short-lived one-time upload session from Limitless.
2. Limitless verifies the storefront Origin against the brand domain/aliases and stores only a SHA-256 hash of the random upload token.
3. Browser uploads one JPEG/PNG/WebP (max 10 MB) to the `facejamas-upload` Supabase Edge Function using that capability token.
4. The function atomically consumes the session, validates the file, stores the source in a private `personalization-assets` bucket, and records an opaque `pers_<uuid>` reference in `limitless.personalizations`.
5. Storefront keeps a local object URL only for preview. Cart handoff contains only the opaque personalization reference.
6. Limitless requires a current FaceJamas personalization reference for every FaceJamas merchandise line. Other brands cannot attach personalization references.
7. Shopify draft line items carry `Personalization ID = pers_<uuid>` as a custom attribute. Draft validation requires Shopify to preserve that exact attribute before payment can be fulfilled.
8. Payment attempts claim the personalization references. A reference claimed by a different attempt cannot be reused accidentally.
9. On Shopify order creation, Limitless binds each personalization to the final order before the payment attempt is marked completed.
10. Admin/fulfillment retrieval uses a separate short-lived one-time access token. `facejamas-asset` consumes it and redirects to a short-lived signed Storage URL.

## Privacy and abuse controls

- Private bucket; no public object URLs.
- Upload and fulfillment-access tokens are random, one-time, short-lived, and stored hashed at rest.
- Upload session TTL: 10 minutes.
- JPEG/PNG/WebP only; MIME + file-signature validation; max 10 MB.
- Storefront Origin allowlist on upload-session issuance.
- Customer rights/consent confirmation in the upload UI.
- Cart/Whop metadata contains only opaque references, never image bytes or object paths.
- Ordered artwork is bound to the Shopify order; orphaned uploads are cleanup-eligible.
- This feature does not enable customer payments by itself.

The browser preview is illustrative. It must not claim to be an exact manufactured garment rendering unless a verified production mockup renderer is later added.