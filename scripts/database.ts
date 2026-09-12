import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { postgresConfig } from "../lib/server/database";

async function main() {
  const command = process.argv[2];
  if (!["check", "migrate"].includes(command)) throw new Error("Unsupported command.");
  if (!process.env.DATABASE_URL) {
    console.error("Save DATABASE_URL in private environment settings first.");
    process.exitCode = 1;
    return;
  }
  const pool = new Pool(postgresConfig(process.env.DATABASE_URL));
  pool.on("error", () => {});
  try {
    await pool.query("SELECT 1");
    console.log("Database authentication and certificate-verified TLS: passed.");
    if (command === "migrate") {
      const client = await pool.connect();
      let failed = false;
      try {
        await client.query(await readFile(new URL("../migrations/001_supabase.sql", import.meta.url), "utf8"));
        await client.query(await readFile(new URL("../migrations/002_payment_foundation.sql", import.meta.url), "utf8"));
        console.log("Private database schema initialized. No sample or existing records were imported.");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch { failed = true; }
        throw error;
      } finally { client.release(failed); }
    }
    const schema = await pool.query("SELECT to_regclass('limitless.metadata') IS NOT NULL AS initialized");
    console.log(`Application schema present: ${schema.rows[0].initialized ? "yes" : "no — run npm run db:migrate"}.`);
  } finally { await pool.end(); }
}

main().catch(error => {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "CONNECTION_OR_CONFIGURATION_ERROR";
  console.error(`Database operation failed (${code}). No connection details were logged.`);
  if (["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(code)) {
    console.error("Download the database CA certificate from Supabase Database Settings → SSL Configuration and save its PEM contents as DATABASE_CA_CERT. Do not disable TLS verification.");
  }
  process.exitCode = 1;
});
