import { z } from "zod";
import { LAUNCH_COUNTRY_CODES } from "../markets";

const text = (max: number) => z.string().trim().min(1).max(max);
const domain = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^$/, "Enter a domain without https:// or a path");
const shopifyDomain = z.string().trim().toLowerCase().max(253).regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$|^$/, "Enter a .myshopify.com domain, not a storefront URL");
const whopCompanyId = z.string().trim().max(100).regex(/^biz_[a-zA-Z0-9]+$|^$/, "Enter a Whop business ID beginning with biz_");
const uniqueDomains = (schema: typeof domain) => z.array(schema.refine(Boolean, "Do not include empty domains")).max(12).refine(values => new Set(values).size === values.length, "Each domain must be unique");
export const accountDetailsInput = z.object({
  shopifyDomain,
  shopifyAliases: uniqueDomains(shopifyDomain),
  whopCompanyId,
  storefrontAliases: uniqueDomains(domain),
  customerAccountDomain: domain,
}).strict();
const money = z.number().finite().min(0).max(100000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, "Use at most two decimal places");
export const checkoutExperienceInput = z.object({
  showPaymentMethods: z.boolean(), showTrustBadges: z.boolean(), showReview: z.boolean(),
  reviewQuote: z.string().trim().max(500), reviewAuthor: z.string().trim().max(80),
  reviewRating: z.number().int().min(1).max(5), reviewConfirmed: z.boolean(),
  deliveryText: z.string().trim().max(500), returnsText: z.string().trim().max(500), showFaq: z.boolean(),
  discountCode: z.string().trim().toUpperCase().max(30).regex(/^[A-Z0-9_-]*$/),
  discountPercent: z.number().int().min(0).max(90), allowTips: z.boolean(),
  priorityEnabled: z.boolean(), priorityLabel: text(80), priorityPrice: money,
  bumpProductId: z.string().max(200),
  offerEndsAt: z.union([z.iso.datetime({ offset: true }), z.literal("")]),
  offerText: z.string().trim().max(160),
}).strict().superRefine((data, ctx) => {
  if (data.reviewConfirmed && (!data.reviewAuthor || !data.reviewQuote)) ctx.addIssue({ code: "custom", message: "Provide a review and author before confirming it as genuine." });
  if (Boolean(data.discountCode) !== (data.discountPercent > 0)) ctx.addIssue({ code: "custom", message: "Provide both a discount code and a positive percentage, or clear both." });
  if (Boolean(data.offerEndsAt) !== Boolean(data.offerText)) ctx.addIssue({ code: "custom", message: "An offer needs both an end time and a description." });
  if (data.offerEndsAt && !data.discountCode) ctx.addIssue({ code: "custom", message: "Configure a discount code before adding its offer deadline." });
});
export const brandInput = z.object({
  name: text(80), category: text(60),
  domain: domain.default(""),
  accent: z.string().regex(/^#[a-fA-F0-9]{6}$/).default("#3c5143"),
  accountDetails: accountDetailsInput.optional(),
}).strict();
export const brandPatch = brandInput.partial().extend({
  domain: brandInput.shape.domain.removeDefault().optional(),
  accent: brandInput.shape.accent.removeDefault().optional(),
  checkoutTitle: text(120).optional(), announcement: z.string().trim().max(180).optional(),
  supportEmail: z.union([z.email().max(254), z.literal("")]).optional(),
  shippingPrice: money.optional(), freeShippingThreshold: money.optional(),
  checkoutExperience: checkoutExperienceInput.optional(),
}).strict().refine(v => Object.keys(v).length > 0, "No changes provided");
export const connectionInput = z.union([
  z.object({ provider: z.literal("shopify"), domain: shopifyDomain.refine(Boolean, "Enter your Shopify API domain"), authMethod: z.literal("client_credentials"), clientId: text(1000), clientSecret: text(1000) }).strict(),
  z.object({ provider: z.literal("shopify"), domain: shopifyDomain.refine(Boolean, "Enter your Shopify API domain"), accessToken: text(1000) }).strict(),
  z.object({ provider: z.literal("whop"), companyId: whopCompanyId.refine(Boolean, "Enter your Whop business ID"), apiKey: text(1000), webhookSecret: text(1000).optional() }).strict(),
]);
export const checkoutInput = z.object({
  mode: z.literal("demo"),
  items: z.array(z.object({ productId: text(200), quantity: z.number().int().min(1).max(20) }).strict()).min(1).max(30).refine(items => new Set(items.map(i => i.productId)).size === items.length, "Duplicate products are not allowed"),
  customer: z.object({ email: z.email().max(254), firstName: text(80), lastName: text(80), address: text(200), city: text(100), postalCode: text(30), country: z.enum(LAUNCH_COUNTRY_CODES) }).strict(),
  options: z.object({
    discountCode: z.string().trim().toUpperCase().max(30).regex(/^[A-Z0-9_-]*$/).optional(),
    tipPercent: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15)]).optional(),
    priority: z.boolean().optional(),
  }).strict().optional(),
}).strict();
export const publishInput = z.object({ mode: z.enum(["demo", "live"]) }).strict();
export const loginInput = z.object({ password: z.string().min(1).max(1024) }).strict();
export const testProductInput = z.object({
  title: text(120), description: z.string().trim().max(500).default(""),
  price: money.refine(value => value > 0, "Price must be greater than zero"),
}).strict();
