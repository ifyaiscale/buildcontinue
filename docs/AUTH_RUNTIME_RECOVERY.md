# Auth runtime recovery

Production administrator authentication no longer depends on Netlify `ADMIN_PASSWORD*` or `SESSION_SECRET` environment variables. Admin login is issued by the Supabase-hosted `limitless-admin-auth-v2` signer and verified in the Next.js runtime with its public P-256 key.

Public customer payments remain disabled during recovery.
