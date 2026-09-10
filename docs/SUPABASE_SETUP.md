# Supabase storage setup

This single-owner app can use Supabase PostgreSQL instead of local SQLite. This is a storage change, not Supabase Auth adoption, a payment launch, or a confirmed resolution of the external Preview cookie problem.

## Private configuration

1. Create a Supabase Free project. Keep its database password in a password manager.
2. In **Connect → Direct / Connection string**, choose the **shared Transaction pooler** (port 6543). This works with serverless hosts and IPv4, including the free tier.
3. Save the full PostgreSQL URI in private environment settings as `DATABASE_URL`. Replace the password placeholder with the database password, not the Supabase account or dashboard admin password. URL-encode special characters in the password locally; never use a public online encoder or share the URI in chat.
4. Preserve `ADMIN_PASSWORD`/`ADMIN_PASSWORD_HASH`, `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`. Use a new, exact HTTPS `APP_URL` for the eventual hosting domain. Do not change the encryption key when moving existing encrypted credentials.
5. Run `npm run db:check`. This performs read-only authentication/TLS and schema-presence checks. It never prints connection details. Error `28P01` means database authentication was rejected: verify the copied project-specific username and database password privately. Reset the database password in Supabase Database Settings if it was not saved correctly, then update the URI. Do not reset the dashboard admin password to fix a database login.
6. Once the check succeeds, run `npm run db:migrate`. This applies `migrations/001_supabase.sql` in a transaction. Re-running it preserves records. It creates a private `limitless` schema, with no guest privileges or RLS policies, and does **not** import local records or create sample brands/orders.
7. Start/restart the app with those private settings. Verify owner sign-in, an empty state, creating a synthetic brand, and persistence across a restart before connecting real providers.

`DATABASE_URL` selects PostgreSQL; a missing, rejected or uninitialized PostgreSQL connection never falls back to SQLite. Omit the variable entirely for local SQLite development. A blank variable is an error. Netlify always requires `DATABASE_URL` to avoid losing records on its ephemeral filesystem. Remote storage cannot activate public demo mode, even in development with missing authentication settings.

The migration intentionally does not touch Supabase's `public`, `auth`, or `storage` tables. Do not expose the `limitless` schema through the Data API or put `DATABASE_URL` in any `NEXT_PUBLIC_*` variable. The initial URI uses the project's privileged database user and must remain server-only; before real transactions, provision and test a least-privilege application role separate from migrations.

## TLS and pooling

The app always verifies the server certificate **and hostname**. It bundles the public CA currently linked by [Supabase Studio's configuration](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json) for Supabase database/pooler hosts only:

- [Official public certificate](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt)
- SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
- Expires April 26, 2031. Recheck the vendor's current certificate during rotation or a verification failure.

`DATABASE_CA_CERT` can supply a replacement trusted PEM certificate (literal newlines or `\n` escapes). Obtain it from Supabase **Database Settings → SSL Configuration** or the relevant database provider. Never set `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, or a no-verification SSL mode.

Each Node instance has at most two database connections. Queries use unnamed statements, compatible with transaction pooling. Transactions keep one checked-out connection until commit/rollback. A transaction-scoped advisory lock serializes the app's JSON read/modify/write operations, slug allocation, and idempotency claims across instances. This favors correctness for a small single-owner workspace; revisit contention before higher-volume use. No session-scoped search path or locks are required.

## Verification and deployment limits

- `npm test` strips the real database/security environment before launching synthetic tests.
- To additionally exercise real PostgreSQL, point `TEST_DATABASE_URL` at an **empty local database named `limitless_test_*`**, then run `npm test`. Remote hosts are refused. The integration test initializes and removes only its `limitless` test schema and may create the test cluster's `anon`/`authenticated` roles. Never point it at an existing workspace database.
- Run `npm run typecheck` and `npm run build` too.
- No SQLite-to-PostgreSQL importer is included. Back up existing local data consistently and get explicit confirmation before migrating or deleting records. Publishing Git changes does not move the private database.
- Netlify deployment is a separate checkpoint. Use Node.js 24, a correct production `APP_URL`, server-only secrets, no development proxy adapter, and verify actual sign-in there. Checkout domains still require exact configured mappings and DNS/TLS.
- Free-plan quotas/inactivity pauses are not payment-grade availability guarantees. Review backups, restoration, usage alerts and upgrade requirements before real payments. The app's rate limiter is still per-process; add trusted edge/distributed protection before a publicly exposed production deployment.
- Live payments, webhooks, real Shopify order writes and production operational readiness remain unimplemented/disabled.

References: [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [TLS guidance](https://supabase.com/docs/guides/platform/ssl-enforcement), [Supabase pricing](https://supabase.com/pricing).
