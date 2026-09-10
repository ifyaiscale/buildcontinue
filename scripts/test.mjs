import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const env = { ...process.env };
for (const key of ["DATABASE_URL", "DATABASE_CA_CERT", "DATABASE_PATH", "ADMIN_PASSWORD", "ADMIN_PASSWORD_HASH", "SESSION_SECRET", "CREDENTIAL_ENCRYPTION_KEY", "APP_URL", "CHECKOUT_ORIGINS", "DEV_PROXY_ORIGIN", "NETLIFY"]) delete env[key];
const files = readdirSync("tests").filter(file => file.endsWith(".test.ts")).map(file => `tests/${file}`);
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { env, stdio: "inherit" });
process.exit(result.status ?? 1);
