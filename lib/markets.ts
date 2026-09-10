export const CHECKOUT_CURRENCY = "USD";
export const LAUNCH_COUNTRY_CODES = ["US", "CA", "GB", "NZ", "AU"] as const;
export const COUNTRY_NAMES: Record<(typeof LAUNCH_COUNTRY_CODES)[number], string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  NZ: "New Zealand",
  AU: "Australia",
};
