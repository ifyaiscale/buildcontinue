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
