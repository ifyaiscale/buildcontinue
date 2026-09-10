import { Dashboard } from "@/components/dashboard";
import { CheckoutPage } from "@/components/checkout";
import { pageSite } from "@/lib/server/page-site";
import "./checkout.css";

export default async function Home() {
  const site = await pageSite("/");
  if (site.kind === "checkout") return <CheckoutPage slug={site.slug} />;
  return <Dashboard />;
}
