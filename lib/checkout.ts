import type { Brand, CheckoutExperience, CheckoutOptions, OrderBreakdown } from "./types";

export const defaultCheckoutExperience: CheckoutExperience = {
  showPaymentMethods: true,
  showTrustBadges: true,
  showReview: true,
  reviewQuote: "Simple from start to finish. Everything I needed to know, all in one place.",
  reviewAuthor: "Example customer",
  reviewRating: 5,
  reviewConfirmed: false,
  deliveryText: "Shipping costs are shown before you place your order.",
  returnsText: "",
  showFaq: true,
  discountCode: "",
  discountPercent: 0,
  allowTips: false,
  priorityEnabled: false,
  priorityLabel: "Priority processing",
  priorityPrice: 4.99,
  bumpProductId: "",
  offerEndsAt: "",
  offerText: "",
};

export function checkoutExperience(brand: Brand): CheckoutExperience {
  return { ...defaultCheckoutExperience, ...brand.checkoutExperience };
}

// All calculations use cents. Free shipping and tips use the discounted merchandise subtotal.
export function checkoutTotals(brand: Brand, items: { price: number; quantity: number }[], options: CheckoutOptions = {}, now = Date.now()): OrderBreakdown {
  const experience = checkoutExperience(brand);
  const subtotal = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
  const code = options.discountCode?.trim().toUpperCase() ?? "";
  if (code && (!experience.discountCode || code !== experience.discountCode.toUpperCase() || experience.discountPercent <= 0)) throw new Error("This discount code is not valid for this checkout.");
  if (code && experience.offerEndsAt && new Date(experience.offerEndsAt).getTime() <= now) throw new Error("This discount offer has expired.");
  if (options.priority && !experience.priorityEnabled) throw new Error("Priority processing is not available.");
  const tipPercent = options.tipPercent ?? 0;
  if (![0, 5, 10, 15].includes(tipPercent) || (tipPercent > 0 && !experience.allowTips)) throw new Error("This tip option is not available.");
  const discount = code ? Math.round(subtotal * experience.discountPercent / 100) : 0;
  const merchandise = subtotal - discount;
  const shipping = merchandise >= Math.round(brand.freeShippingThreshold * 100) ? 0 : Math.round(brand.shippingPrice * 100);
  const priority = options.priority ? Math.round(experience.priorityPrice * 100) : 0;
  const tip = Math.round(merchandise * tipPercent / 100);
  return { subtotal: subtotal / 100, discount: discount / 100, shipping: shipping / 100, priority: priority / 100, tip: tip / 100, total: (merchandise + shipping + priority + tip) / 100 };
}
