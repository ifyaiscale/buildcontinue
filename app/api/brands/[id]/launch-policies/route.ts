import { launchAdminAction } from "@/lib/server/launch-admin-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return launchAdminAction(request, id, "policy-status");
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let input: Record<string, unknown> = {};
  try { input = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "Invalid policy approval request." }, { status: 400 }); }
  if (input.acknowledge !== true) return Response.json({ error: "Confirm that you reviewed and approve the current launch policies." }, { status: 422 });
  return launchAdminAction(request, id, "approve-policy", { acknowledge: true });
}
