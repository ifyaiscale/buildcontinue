import { z } from "zod";
import { createHash } from "node:crypto";
import type { Product } from "../types";
import { HttpError } from "./security";

export type ShopifyCredentials = { domain: string; accessToken: string; authMethod?: "access_token" } | { domain: string; authMethod: "client_credentials"; clientId: string; clientSecret: string };
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const tokenRequests = new Map<string, Promise<string>>();
export function sameShopifyCredentials(a: ShopifyCredentials, b: ShopifyCredentials) {
  return a.domain === b.domain && (a.authMethod === "client_credentials"
    ? b.authMethod === "client_credentials" && a.clientId === b.clientId && a.clientSecret === b.clientSecret
    : b.authMethod !== "client_credentials" && a.accessToken === b.accessToken);
}
async function shopifyToken(credentials: ShopifyCredentials, refresh = false): Promise<string> {
  if (credentials.authMethod !== "client_credentials") return credentials.accessToken;
  const key = createHash("sha256").update(JSON.stringify([credentials.domain, credentials.clientId, credentials.clientSecret])).digest("hex");
  const cached = tokenCache.get(key);
  const pending = tokenRequests.get(key);
  if (pending) return pending;
  if (!refresh && cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  if (refresh) tokenCache.delete(key);
  const request = (async () => {
    const startedAt = Date.now();
    let result: unknown;
    try {
      result = await remote(`https://${credentials.domain}/admin/oauth/access_token`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret }),
      });
    } catch {
      throw new HttpError(422, "Shopify app authorization failed. Confirm the app is installed on this store, both belong to the same eligible Shopify organization, and the Client ID and Client secret are correct.");
    }
    const parsed = z.object({ access_token: z.string().min(1).max(2000), expires_in: z.number().int().min(61).max(86400) }).safeParse(result);
    if (!parsed.success) throw new HttpError(502, "Shopify returned an invalid access token or expiry.");
    for (const [cacheKey, value] of tokenCache) if (value.expiresAt <= Date.now() + 60000) tokenCache.delete(cacheKey);
    if (tokenCache.size >= 100) tokenCache.delete(tokenCache.keys().next().value!);
    tokenCache.set(key, { token: parsed.data.access_token, expiresAt: startedAt + parsed.data.expires_in * 1000 });
    return parsed.data.access_token;
  })();
  tokenRequests.set(key, request);
  try { return await request; } finally { tokenRequests.delete(key); }
}
const version = "2026-07";

async function remote(url: string, init: RequestInit) {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) }); }
  catch { throw new HttpError(502, "Provider could not be reached. Check your account details and try again."); }
  if (response.status === 401 || response.status === 403) throw new HttpError(422, "Provider rejected these credentials or permissions. Check the API key and required scopes.");
  if (response.status === 429) throw new HttpError(429, "Provider rate limit reached. Try again shortly.");
  if (!response.ok) throw new HttpError(502, "Provider verification failed. Check the account identifier and try again.");
  try { return await response.json(); }
  catch { throw new HttpError(502, "Provider returned an invalid response."); }
}

export async function shopifyGraphql(credentials: ShopifyCredentials, query: string, variables: object = {}) {
  // Never accept arbitrary hosts or follow redirects with an access token.
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(credentials.domain)) throw new HttpError(422, "Use your permanent .myshopify.com domain.");
  const result = await remote(`https://${credentials.domain}/admin/api/${version}/graphql.json`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await shopifyToken(credentials) }, body: JSON.stringify({ query, variables }),
  });
  if (!result?.data || result.errors?.length) throw new HttpError(422, "Shopify could not complete this request. Check the required permissions and supported input.");
  return result.data;
}

export async function verifyShopify(credentials: ShopifyCredentials, additionalScopes: readonly string[] = []) {
  return verifyShopifyScopes(credentials, additionalScopes, true);
}

async function verifyShopifyScopes(credentials: ShopifyCredentials, additionalScopes: readonly string[], retry: boolean): Promise<string> {
  const data = await shopifyGraphql(credentials, `{ shop { name myshopifyDomain currencyCode } currentAppInstallation { accessScopes { handle } } }`);
  const parsed = z.object({ shop: z.object({ name: z.string(), myshopifyDomain: z.string(), currencyCode: z.string() }), currentAppInstallation: z.object({ accessScopes: z.array(z.object({ handle: z.string() })) }) }).safeParse(data);
  if (!parsed.success) throw new HttpError(502, "Shopify returned an incomplete store identity or app-permissions response. The connection was not saved.");
  const returnedDomain = parsed.data.shop.myshopifyDomain.toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(returnedDomain)) throw new HttpError(502, "Shopify returned an invalid store domain. The connection was not saved.");
  if (returnedDomain !== credentials.domain.toLowerCase()) throw new HttpError(422, `Shopify identifies this store as ${returnedDomain}, but you entered ${credentials.domain}. Check that the returned domain belongs to this brand in Shopify Settings → Domains, then enter that domain and verify again. The connection was not saved.`);
  const scopes = parsed.data.currentAppInstallation.accessScopes.map(s => s.handle);
  const missingCatalog = !scopes.some(s => s === "read_products" || s === "write_products") || !scopes.some(s => s === "read_inventory" || s === "write_inventory");
  const missingAdditional = additionalScopes.some(scope => !scopes.includes(scope));
  if ((missingCatalog || missingAdditional) && retry && credentials.authMethod === "client_credentials") {
    // A released scope change can leave a cached token with its previous grants.
    // Retry identity and permissions once with a newly requested token; never bypass them.
    await shopifyToken(credentials, true);
    return verifyShopifyScopes(credentials, additionalScopes, false);
  }
  if (!scopes.some(s => s === "read_products" || s === "write_products") || !scopes.some(s => s === "read_inventory" || s === "write_inventory")) throw new HttpError(422, "Grant read_products and read_inventory to import the product catalog safely.");
  if (additionalScopes.some(scope => !scopes.includes(scope))) throw new HttpError(422, `Grant ${additionalScopes.join(" and ")} before running this operation.`);
  if (parsed.data.shop.currencyCode !== "USD") throw new HttpError(422, "This MVP supports USD stores only. Multi-currency pricing must be implemented before importing this store.");
  return credentials.domain;
}

export async function verifyWhop(companyId: string, apiKey: string) {
  const result = await remote(`https://api.whop.com/api/v1/companies/${encodeURIComponent(companyId)}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
  const parsed = z.object({ id: z.string() }).safeParse(result);
  if (!parsed.success || parsed.data.id !== companyId) throw new HttpError(422, "Whop returned a different company. Check the company ID and API key.");
  return companyId;
}

const variantSchema = z.object({
  id: z.string(), title: z.string(), price: z.string(), compareAtPrice: z.string().nullable(),
  inventoryQuantity: z.number().nullable(), inventoryPolicy: z.enum(["DENY", "CONTINUE"]),
  inventoryItem: z.object({ tracked: z.boolean() }), image: z.object({ url: z.string() }).nullable(),
  product: z.object({ title: z.string(), description: z.string(), status: z.string(), featuredImage: z.object({ url: z.string() }).nullable() }),
});

export async function syncShopify(credentials: ShopifyCredentials): Promise<Product[]> {
  await verifyShopify(credentials);
  const products: Product[] = []; let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data = await shopifyGraphql(credentials, `query Catalog($after: String) { productVariants(first: 100, after: $after, query: "product_status:active") { nodes { id title price compareAtPrice inventoryQuantity inventoryPolicy inventoryItem { tracked } image { url } product { title description status featuredImage { url } } } pageInfo { hasNextPage endCursor } } }`, { after: cursor });
    const parsed = z.object({ productVariants: z.object({ nodes: z.array(variantSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }) }).safeParse(data);
    if (!parsed.success) throw new HttpError(502, "Shopify returned an unsupported catalog response.");
    for (const variant of parsed.data.productVariants.nodes) {
      const price = Number(variant.price); const compare = variant.compareAtPrice === null ? undefined : Number(variant.compareAtPrice);
      if (!Number.isFinite(price) || price < 0 || price > 100000 || Math.abs(price * 100 - Math.round(price * 100)) > 0.00001) throw new HttpError(422, "A product price is outside the supported USD range.");
      const image = variant.image?.url ?? variant.product.featuredImage?.url;
      products.push({ id: variant.id, variantId: variant.id, title: `${variant.product.title}${variant.title === "Default Title" ? "" : ` · ${variant.title}`}`, description: variant.product.description.slice(0, 1000), price, ...(compare !== undefined && Number.isFinite(compare) && compare > price ? { compareAtPrice: compare } : {}), ...(image?.startsWith("https://cdn.shopify.com/") ? { image } : {}), available: variant.product.status === "ACTIVE" && (!variant.inventoryItem.tracked || variant.inventoryPolicy === "CONTINUE" || (variant.inventoryQuantity ?? 0) > 0) });
    }
    if (!parsed.data.productVariants.pageInfo.hasNextPage) return products;
    const next = parsed.data.productVariants.pageInfo.endCursor;
    if (!next || next === cursor) throw new HttpError(502, "Shopify catalog pagination failed; existing products were kept.");
    cursor = next;
  }
  throw new HttpError(422, "Catalog exceeds the MVP limit of 2,000 variants. Existing products were kept; implement a background bulk import for this store.");
}
