import { notFound } from "next/navigation";
import { LaunchCenter } from "@/components/launch-center";
import { pageSite } from "@/lib/server/page-site";

export default async function LaunchCenterPage() {
  const site = await pageSite("/launch-center");
  if (site.kind !== "admin") notFound();
  return <LaunchCenter />;
}
