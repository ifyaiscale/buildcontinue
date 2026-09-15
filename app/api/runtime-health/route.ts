export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  const adminHash = process.env.ADMIN_PASSWORD_HASH || "";
  const session = process.env.SESSION_SECRET || "";
  const database = process.env.DATABASE_URL || "";
  const encryption = process.env.CREDENTIAL_ENCRYPTION_KEY || "";
  return Response.json({
    adminCredentialPresent: adminPassword.length >= 16 || adminHash.length > 0,
    sessionSecretPresent: session.length >= 32,
    databaseUrlPresent: database.length > 0,
    credentialEncryptionKeyPresent: /^[a-fA-F0-9]{64}$/.test(encryption),
    supabaseAnonPresent: (process.env.SUPABASE_PUBLIC_ANON_KEY || "").length > 0,
  }, { headers: { "Cache-Control": "no-store" } });
}
