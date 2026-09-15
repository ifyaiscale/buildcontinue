# Admin auth recovery — 2026-09-14

This commit exists to force a fresh Netlify production deploy after repairing administrator authentication.

- Removed the previously broken ADMIN_PASSWORD_HASH value.
- Replaced it with a newly generated, correctly formatted scrypt ADMIN_PASSWORD_HASH.
- Rotated SESSION_SECRET with explicit build/function/runtime/post-processing scopes.
- Shopify, Whop, CREDENTIAL_ENCRYPTION_KEY, DATABASE_URL, payment gates, and brand data were not changed.
- PUBLIC_PAYMENT_ENABLED remains false.

After this commit is live, the administrator UI should report authentication configured and accept the corresponding temporary password.
