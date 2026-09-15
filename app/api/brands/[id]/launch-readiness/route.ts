import { launchAdminAction } from "@/lib/server/launch-admin-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return launchAdminAction(request, id, "readiness");
}
