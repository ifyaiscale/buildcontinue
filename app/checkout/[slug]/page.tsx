import { CheckoutPage } from "@/components/checkout";
import { CartCheckoutError, CartCheckoutPage } from "@/components/cart-checkout";
import { publicCartBrand, readCartSession } from "@/lib/server/cart-session";
import { pageSite } from "@/lib/server/page-site";
import { store } from "@/lib/server/store";
import "../../checkout.css";

export default async function PublicCheckoutPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ cart?: string | string[] }> }) {
  const { slug } = await params;
  await pageSite(`/checkout/${slug}`);
  const query = await searchParams;
  const token = typeof query.cart === "string" ? query.cart : "";
  if (!token) return <CheckoutPage slug={slug} />;

  let domain = "";
  try {
    const db = await store();
    const brand = await db.brand(slug, true);
    domain = brand.domain;
    const session = readCartSession(brand, token);
    return <CartCheckoutPage brand={publicCartBrand(brand)} initialItems={session.items} />;
  } catch {
    return <CartCheckoutError domain={domain} />;
  }
}
