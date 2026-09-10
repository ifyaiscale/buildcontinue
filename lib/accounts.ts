import type { AccountDetails, Brand } from "./types";

export function accountDetails(brand: Brand): AccountDetails {
  return {
    shopifyDomain: brand.shopify.account || (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(brand.domain) ? brand.domain.toLowerCase() : ""),
    shopifyAliases: [],
    whopCompanyId: brand.whop.account || "",
    storefrontAliases: [],
    customerAccountDomain: "",
    ...brand.accountDetails,
  };
}
