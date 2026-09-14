import { notFound } from "next/navigation";
import { FaceJamasFulfillment } from "@/components/facejamas-fulfillment";
import { pageSite } from "@/lib/server/page-site";

export default async function FaceJamasFulfillmentPage() {
  const site = await pageSite("/facejamas-fulfillment");
  if (site.kind !== "admin") notFound();
  return <FaceJamasFulfillment />;
}
