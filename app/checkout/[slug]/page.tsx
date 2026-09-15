import type { Metadata } from "next";
import { cookies } from "next/headers";
import { CartCheckoutError, CartCheckoutPage, type HandoffCartItem } from "@/components/cart-checkout";
import { PaymentReturnPage } from "@/components/payment-return";
import { pageSite } from "@/lib/server/page-site";
import type { Brand } from "@/lib/types";
import "../../checkout.css";
import "../white-label.css";

const CHECKOUT_RUNTIME = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-checkout-runtime";
const checkoutTitles: Record<string, string> = {
  chefings: "CHEFINGS · Secure checkout",
  cozyinfants: "Cozy Infants · Secure checkout",
  facejamas: "FaceJamas · Secure checkout",
};

type CheckoutView = { brand: Brand; items?: HandoffCartItem[]; expiresAt?: number };

async function checkoutView(slug: string, cartToken?: string): Promise<CheckoutView> {
  const response = await fetch(CHECKOUT_RUNTIME, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "view", slug, ...(cartToken ? { cartToken } : {}) }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Checkout state unavailable");
  const result = await response.json() as CheckoutView;
  if (!result?.brand || result.brand.slug !== slug) throw new Error("Checkout state invalid");
  return result;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: checkoutTitles[slug] || "Secure checkout",
    description: "Secure checkout.",
    robots: { index: false, follow: false },
  };
}

export default async function PublicCheckoutPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ cart?: string | string[]; receipt?: string | string[] }> }) {
  const { slug } = await params;
  await pageSite(`/checkout/${slug}`);
  const query = await searchParams;
  const receipt = typeof query.receipt === "string" ? query.receipt : "";

  if (receipt) {
    try {
      const { brand } = await checkoutView(slug);
      const cookieStore = await cookies();
      const rawAttempt = cookieStore.get(`limitless_acceptance_attempt_${slug}`)?.value || "";
      const acceptanceAttempt = /^attempt_[0-9a-f-]{36}$/.test(rawAttempt) ? rawAttempt : undefined;
      return <PaymentReturnPage brand={brand} receipt={receipt} acceptanceAttempt={acceptanceAttempt} />;
    } catch {
      return <CartCheckoutError />;
    }
  }

  const token = typeof query.cart === "string" ? query.cart : "";
  if (!token) {
    try {
      const { brand } = await checkoutView(slug);
      return <CartCheckoutError domain={brand.domain} />;
    } catch {
      return <CartCheckoutError />;
    }
  }

  try {
    const view = await checkoutView(slug, token);
    if (!Array.isArray(view.items) || view.items.length === 0) throw new Error("Checkout cart unavailable");
    return <CartCheckoutPage brand={view.brand} initialItems={view.items} cartToken={token} />;
  } catch {
    try {
      const { brand } = await checkoutView(slug);
      return <CartCheckoutError domain={brand.domain} />;
    } catch {
      return <CartCheckoutError />;
    }
  }
}
