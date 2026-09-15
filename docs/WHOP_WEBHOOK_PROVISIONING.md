# Whop webhook provisioning

Production uses the stable checkout/auth baseline plus a narrowly scoped admin-only webhook provisioner.

- Requires the existing authenticated Limitless admin session.
- Uses each brand's already-encrypted Whop API credentials.
- Creates only `payment.succeeded` for that brand.
- Callback path uses the Limitless brand ID because the webhook receiver resolves IDs, not slugs.
- Stores the one-time Whop signing secret back into the encrypted Whop credential record.
- Does not enable `PUBLIC_PAYMENT_ENABLED`.
