import { z } from "zod";
import type { Product } from "../types";
import { HttpError } from "./security";

export type ShopifyCredentials = { domain: string; accessToken: string };
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

async function graphql(credentials: ShopifyCredentials, query: string, variables: object = {}) {
  // Never accept arbitrary hosts or follow redirects with an access token.
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(credentials.domain)) throw new HttpError(422, "Use your permanent .myshopify.com domain.");
  const result = await remote(`https://${credentials.domain}/admin/api/${version}/graphql.json`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": credentials.accessToken }, body: JSON.stringify({ query, variables }),
  });
  if (!result.data || result.errors?.length) throw new HttpError(422, "Shopify could not complete this request. Verify the app has read_products and read_inventory permissions.");
  return result.data;
}

export async function verifyShopify(credentials: ShopifyCredentials) {
  const data = await graphql(credentials, `{ shop { name myshopifyDomain currencyCode } currentAppInstallation { accessScopes { handle } } }`);
  const parsed = z.object({ shop: z.object({ name: z.string(), myshopifyDomain: z.string(), currencyCode: z.string() }), currentAppInstallation: z.object({ accessScopes: z.array(z.object({ handle: z.string() })) }) }).safeParse(data);
  if (!parsed.success || parsed.data.shop.myshopifyDomain !== credentials.domain) throw new HttpError(422, "Shopify account did not match the requested store.");
  const scopes = parsed.data.currentAppInstallation.accessScopes.map(s => s.handle);
  if (!scopes.some(s => s === "read_products" || s === "write_products") || !scopes.some(s => s === "read_inventory" || s === "write_inventory")) throw new HttpError(422, "Grant read_products and read_inventory to import the product catalog safely.");
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
    const data = await graphql(credentials, `query Catalog($after: String) { productVariants(first: 100, after: $after, query: "product_status:active") { nodes { id title price compareAtPrice inventoryQuantity inventoryPolicy inventoryItem { tracked } image { url } product { title description status featuredImage { url } } } pageInfo { hasNextPage endCursor } } }`, { after: cursor });
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
