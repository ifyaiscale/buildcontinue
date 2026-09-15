import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const encoder = new TextEncoder();
const AUTH_MATERIAL = "limitless_admin_auth_material?id=eq.production&select=public_jwk";
const CRYPTO_MATERIAL = "limitless_provider_crypto_material?id=eq.production&select=key_jwk";
const CREDENTIALS = "limitless_provider_credentials_v2";
const SHOPIFY_VERSION = "2026-07";

type ShopifyConnection =
  | { provider: "shopify"; domain: string; authMethod: "client_credentials"; clientId: string; clientSecret: string }
  | { provider: "shopify"; domain: string; accessToken: string };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function b64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function rest(path: string, init: RequestInit = {}) {
  const base = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
async function validToken(token: string) {
  if (!token || token.length > 2048) return false;
  const [encoded, signature, ...extra] = token.split(".");
  if (extra.length || !encoded || !signature) return false;
  try {
    const response = await rest(AUTH_MATERIAL);
    if (!response.ok) return false;
    const rows = await response.json() as Array<{ public_jwk?: JsonWebKey }>;
    const jwk = rows[0]?.public_jwk;
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromB64url(signature), encoder.encode(encoded));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(encoded))) as { v?: number; aud?: string; iat?: number; exp?: number; nonce?: string };
    const now = Math.floor(Date.now() / 1000);
    return payload.v === 2 && payload.aud === "limitless-admin" && Number.isInteger(payload.iat) && Number.isInteger(payload.exp) && typeof payload.nonce === "string" && payload.exp! > now && payload.exp! <= now + 8 * 60 * 60 + 60;
  } catch { return false; }
}
function text(value: unknown, max = 2000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : "";
}
function shopDomain(value: unknown) {
  const domain = text(value, 253).toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(domain) ? domain : "";
}
async function currentBrand(brandId: string) {
  const response = await rest("rpc/limitless_brand_get", { method: "POST", body: JSON.stringify({ p_brand_id: brandId }) });
  if (!response.ok) throw new Error("brand-read");
  return await response.json() as Record<string, unknown>;
}
async function encryptionKey() {
  const response = await rest(CRYPTO_MATERIAL);
  if (!response.ok) throw new Error("encryption-key-read");
  const rows = await response.json() as Array<{ key_jwk?: JsonWebKey }>;
  const k = typeof rows[0]?.key_jwk?.k === "string" ? rows[0]!.key_jwk!.k! : "";
  if (!k) throw new Error("encryption-key-missing");
  const raw = fromB64url(k);
  if (raw.byteLength !== 32) throw new Error("encryption-key-length");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
}
async function saveCredential(brandId: string, value: unknown) {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = encoder.encode(`limitless:${brandId}:shopify:v2`);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, encoder.encode(JSON.stringify(value))));
  const response = await rest(`${CREDENTIALS}?on_conflict=brand_id,provider`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ brand_id: brandId, provider: "shopify", iv: b64url(iv), ciphertext: b64url(encrypted), updated_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    let detail = `credential-save-${response.status}`;
    try { const body = await response.json() as Record<string, unknown>; if (typeof body.code === "string") detail += `:${body.code}`; } catch { /* no-op */ }
    throw new Error(detail);
  }
}
async function providerFetch(url: string, init: RequestInit) {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error("Shopify could not be reached."); }
  if (response.status === 401 || response.status === 403) throw new Error("Shopify rejected these credentials or permissions.");
  if (response.status === 429) throw new Error("Shopify rate limit reached. Try again shortly.");
  if (!response.ok) throw new Error(`Shopify verification failed (HTTP ${response.status}).`);
  try { return await response.json(); } catch { throw new Error("Shopify returned an invalid response."); }
}
async function accessToken(connection: ShopifyConnection) {
  if (!("authMethod" in connection) || connection.authMethod !== "client_credentials") return connection.accessToken;
  const form = new URLSearchParams({ grant_type: "client_credentials", client_id: connection.clientId, client_secret: connection.clientSecret }).toString();
  const result = await providerFetch(`https://${connection.domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  }) as Record<string, unknown>;
  const token = typeof result.access_token === "string" ? result.access_token : "";
  if (!token || token.length > 2000) throw new Error("Shopify returned an invalid access token.");
  return token;
}
async function verifyShopify(connection: ShopifyConnection) {
  const token = await accessToken(connection);
  const result = await providerFetch(`https://${connection.domain}/admin/api/${SHOPIFY_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: `{ shop { myshopifyDomain } currentAppInstallation { accessScopes { handle } } }` }),
  }) as { data?: { shop?: { myshopifyDomain?: unknown }; currentAppInstallation?: { accessScopes?: Array<{ handle?: unknown }> } }; errors?: unknown[] };
  if (result.errors?.length) throw new Error("Shopify rejected the verification query.");
  const returned = typeof result.data?.shop?.myshopifyDomain === "string" ? result.data.shop.myshopifyDomain.toLowerCase() : "";
  if (returned !== connection.domain) throw new Error(`Shopify identifies this store as ${returned || "another store"}.`);
  const scopes = Array.isArray(result.data?.currentAppInstallation?.accessScopes)
    ? result.data!.currentAppInstallation!.accessScopes!.map(s => typeof s.handle === "string" ? s.handle : "")
    : [];
  const products = scopes.includes("read_products") || scopes.includes("write_products");
  const inventory = scopes.includes("read_inventory") || scopes.includes("write_inventory");
  const draftOrders = scopes.includes("write_draft_orders");
  if (!products || !inventory || !draftOrders) {
    throw new Error("Grant read_products, read_inventory, and write_draft_orders before connecting Shopify.");
  }
  return { domain: returned, token, scopes };
}
function parseConnection(value: unknown): ShopifyConnection {
  if (!value || typeof value !== "object") throw new Error("Invalid Shopify connection details.");
  const input = value as Record<string, unknown>;
  if (input.provider !== "shopify") throw new Error("Unsupported provider.");
  const domain = shopDomain(input.domain);
  if (!domain) throw new Error("Enter a valid .myshopify.com domain.");
  if (input.authMethod === "client_credentials") {
    const clientId = text(input.clientId); const clientSecret = text(input.clientSecret);
    if (!clientId || !clientSecret) throw new Error("Enter the Shopify Client ID and Client secret.");
    return { provider: "shopify", domain, authMethod: "client_credentials", clientId, clientSecret };
  }
  const accessToken = text(input.accessToken);
  if (!accessToken) throw new Error("Enter the Shopify Admin API access token.");
  return { provider: "shopify", domain, accessToken };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const token = typeof payload.token === "string" ? payload.token : "";
  if (!(await validToken(token))) return json({ error: "Sign in to manage your workspace." }, 401);
  const brandId = text(payload.brandId, 100);
  if (!/^brand_[A-Za-z0-9-]+$/.test(brandId)) return json({ error: "Invalid brand." }, 422);
  let connection: ShopifyConnection;
  try { connection = parseConnection(payload.connection); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid Shopify connection details." }, 422); }

  let brand: Record<string, unknown>;
  try { brand = await currentBrand(brandId); }
  catch { return json({ error: "Brand could not be loaded." }, 503); }
  const shopify = brand.shopify && typeof brand.shopify === "object" ? brand.shopify as Record<string, unknown> : {};
  const existingAccount = typeof shopify.account === "string" ? shopify.account.toLowerCase() : "";
  if (existingAccount && existingAccount !== connection.domain) return json({ error: "This Shopify store does not match the store already assigned to this brand." }, 409);

  let verified: { domain: string; token: string; scopes: string[] };
  try { verified = await verifyShopify(connection); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Shopify verification failed." }, 422); }

  try {
    const saved = "authMethod" in connection && connection.authMethod === "client_credentials"
      ? { provider: "shopify", domain: connection.domain, authMethod: "client_credentials", clientId: connection.clientId, clientSecret: connection.clientSecret }
      : { provider: "shopify", domain: connection.domain, accessToken: verified.token };
    await saveCredential(brandId, saved);
  } catch (error) {
    const stage = error instanceof Error ? error.message : "secure-save";
    return json({ error: `Shopify verified, but secure credential storage failed (${stage}).` }, 503);
  }

  return json(brand);
});
