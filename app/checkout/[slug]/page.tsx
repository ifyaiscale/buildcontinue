import type { Metadata } from "next";
import { CheckoutPage } from "@/components/checkout";
import { CartCheckoutError, CartCheckoutPage } from "@/components/cart-checkout";
import { PaymentReturnPage } from "@/components/payment-return";
import { publicCartBrand, readCartSession } from "@/lib/server/cart-session";
import { pageSite } from "@/lib/server/page-site";
import { store } from "@/lib/server/store";
import "../../checkout.css";
import "../white-label.css";

const checkoutTitles: Record<string, string> = {
  chefings: "CHEFINGS · Secure checkout",
  cozyinfants: "Cozy Infants · Secure checkout",
  facejamas: "FaceJamas · Secure checkout",
};

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
      const db = await store();
      const brand = await db.brand(slug, true);
      return <PaymentReturnPage brand={publicCartBrand(brand)} receipt={receipt} />;
    } catch {
      return <CartCheckoutError />;
    }
  }

  const token = typeof query.cart === "string" ? query.cart : "";
  if (!token) return <CheckoutPage slug={slug} />;

  let domain = "";
  try {
    const db = await store();
    const brand = await db.brand(slug, true);
    domain = brand.domain;
    const session = readCartSession(brand, token);
    return <CartCheckoutPage brand={publicCartBrand(brand)} initialItems={session.items} cartToken={token} />;
  } catch {
    return <CartCheckoutError domain={domain} />;
  }
}
