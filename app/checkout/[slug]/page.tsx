import { CheckoutPage } from "@/components/checkout";
import { pageSite } from "@/lib/server/page-site";
import "../../checkout.css";

export default async function PublicCheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await pageSite(`/checkout/${slug}`);
  return <CheckoutPage slug={slug} />;
}
