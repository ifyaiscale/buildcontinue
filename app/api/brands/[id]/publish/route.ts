import { publish as legacyPublish } from "@/lib/server/api";
import { launchAdminAction } from "@/lib/server/launch-admin-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let input: Record<string, unknown> = {};
  try { input = await request.clone().json() as Record<string, unknown>; }
  catch { return Response.json({ error: "Invalid publish request." }, { status: 400 }); }

  if (input.mode === "live") return launchAdminAction(request, id, "activate-live");
  return legacyPublish(request);
}
