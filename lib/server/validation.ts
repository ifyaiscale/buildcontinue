import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const money = z.number().finite().min(0).max(100000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, "Use at most two decimal places");
export const brandInput = z.object({
  name: text(80), category: text(60),
  domain: z.string().trim().max(253).regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$|^$/, "Enter a domain without https:// or a path").default(""),
  accent: z.string().regex(/^#[a-fA-F0-9]{6}$/).default("#3c5143"),
}).strict();
export const brandPatch = brandInput.partial().extend({
  domain: brandInput.shape.domain.removeDefault().optional(),
  accent: brandInput.shape.accent.removeDefault().optional(),
  checkoutTitle: text(120).optional(), announcement: z.string().trim().max(180).optional(),
  supportEmail: z.union([z.email().max(254), z.literal("")]).optional(),
  shippingPrice: money.optional(), freeShippingThreshold: money.optional(),
}).strict().refine(v => Object.keys(v).length > 0, "No changes provided");
export const connectionInput = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("shopify"), domain: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/), accessToken: text(1000) }).strict(),
  z.object({ provider: z.literal("whop"), companyId: z.string().regex(/^biz_[a-zA-Z0-9]+$/).max(100), apiKey: text(1000), webhookSecret: text(1000).optional() }).strict(),
]);
export const checkoutInput = z.object({
  mode: z.literal("demo"),
  items: z.array(z.object({ productId: text(200), quantity: z.number().int().min(1).max(20) }).strict()).min(1).max(30).refine(items => new Set(items.map(i => i.productId)).size === items.length, "Duplicate products are not allowed"),
  customer: z.object({ email: z.email().max(254), firstName: text(80), lastName: text(80), address: text(200), city: text(100), postalCode: text(30), country: text(80) }).strict(),
}).strict();
export const publishInput = z.object({ mode: z.enum(["demo", "live"]) }).strict();
export const loginInput = z.object({ password: z.string().min(1).max(1024) }).strict();
export const testProductInput = z.object({
  title: text(120), description: z.string().trim().max(500).default(""),
  price: money.refine(value => value > 0, "Price must be greater than zero"),
}).strict();
