export type Connection = {
  status: "not_connected" | "verified" | "error";
  account?: string;
  checkedAt?: string;
  error?: string;
};

export type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  image?: string;
  variantId?: string;
  available: boolean;
};

export type CheckoutExperience = {
  showPaymentMethods: boolean;
  showTrustBadges: boolean;
  showReview: boolean;
  reviewQuote: string;
  reviewAuthor: string;
  reviewRating: number;
  reviewConfirmed: boolean;
  deliveryText: string;
  returnsText: string;
  showFaq: boolean;
  discountCode: string;
  discountPercent: number;
  allowTips: boolean;
  priorityEnabled: boolean;
  priorityLabel: string;
  priorityPrice: number;
  bumpProductId: string;
  offerEndsAt: string;
  offerText: string;
};

export type CheckoutOptions = {
  discountCode?: string;
  tipPercent?: 0 | 5 | 10 | 15;
  priority?: boolean;
};

export type OrderBreakdown = {
  subtotal: number;
  discount: number;
  shipping: number;
  priority: number;
  tip: number;
  total: number;
};

export type Brand = {
  id: string;
  name: string;
  slug: string;
  category: string;
  domain: string;
  accent: string;
  logoInitial: string;
  checkoutTitle: string;
  announcement: string;
  supportEmail: string;
  shippingPrice: number;
  freeShippingThreshold: number;
  status: "draft" | "live";
  mode: "demo" | "live";
  shopify: Connection;
  whop: Connection;
  products: Product[];
  createdAt: string;
  checkoutExperience?: CheckoutExperience;
};

export type Order = {
  id: string;
  brandId: string;
  customer: string;
  email: string;
  total: number;
  currency: string;
  status: "paid" | "pending" | "failed";
  syncStatus: "synced" | "pending" | "failed" | "demo";
  mode: "demo" | "live";
  items: { title: string; quantity: number; price: number }[];
  breakdown?: OrderBreakdown;
  createdAt: string;
};

export type Activity = {
  id: string;
  brandId?: string;
  message: string;
  createdAt: string;
  type: "order" | "connection" | "brand";
};

export type AppState = {
  brands: Brand[];
  orders: Order[];
  activity: Activity[];
  environment: {
    demo: boolean;
    liveEnabled: boolean;
    credentialsConfigured: boolean;
    authenticated: boolean;
  };
};
