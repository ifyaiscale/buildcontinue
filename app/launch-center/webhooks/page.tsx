import { notFound } from "next/navigation";
import { WhopWebhookSetup } from "@/components/whop-webhook-setup";
import { pageSite } from "@/lib/server/page-site";

export default async function WhopWebhookSetupPage() {
  const site = await pageSite("/launch-center/webhooks");
  if (site.kind !== "admin") notFound();
  return <WhopWebhookSetup />;
}
