import { Dashboard } from "@/components/dashboard";
import { CheckoutPage } from "@/components/checkout";
import { pageSite } from "@/lib/server/page-site";
import "./checkout.css";

async function reportRuntimeHealth() {
  if (process.env.NODE_ENV !== "production") return;
  const payload = {
    adminCredentialPresent: (process.env.ADMIN_PASSWORD || "").length >= 16 || (process.env.ADMIN_PASSWORD_HASH || "").length > 0,
    sessionSecretPresent: (process.env.SESSION_SECRET || "").length >= 32,
    databaseUrlPresent: (process.env.DATABASE_URL || "").length > 0,
    credentialEncryptionKeyPresent: /^[a-fA-F0-9]{64}$/.test(process.env.CREDENTIAL_ENCRYPTION_KEY || ""),
    supabaseAnonPresent: (process.env.SUPABASE_PUBLIC_ANON_KEY || "").length > 0,
  };
  try {
    await fetch("https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-runtime-health-probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Temporary diagnostics must never block the storefront or admin UI.
  }
}

export default async function Home() {
  await reportRuntimeHealth();
  const site = await pageSite("/");
  if (site.kind === "checkout") return <CheckoutPage slug={site.slug} />;
  return <Dashboard />;
}
