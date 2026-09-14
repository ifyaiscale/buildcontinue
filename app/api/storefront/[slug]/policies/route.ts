import { launchPolicyStatus } from "@/lib/server/launch-policies";
import { rateLimit } from "@/lib/server/security";
import { store } from "@/lib/server/store";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET(request: Request) {
  try {
    rateLimit("public-storefront-policy", 240, 60_000);
    const slug = /^\/api\/storefront\/([a-z0-9-]+)\/policies$/.exec(new URL(request.url).pathname.replace(/\/$/, ""))?.[1] ?? "";
    if (!slugPattern.test(slug)) return Response.json({ error: "Store not found." }, { status: 404 });
    const db = await store();
    const brand = await db.brand(slug, true);
    const status = await launchPolicyStatus(db, brand.id);
    return Response.json({
      brand: { name: brand.name, slug: brand.slug, domain: brand.domain },
      approved: status.approved,
      approvedAt: status.approvedAt,
      policy: status.policy,
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Customer policy is unavailable." }, { status: 404, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  }
}
