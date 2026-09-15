import { editBrand as legacyEditBrand } from "@/lib/server/api";
import { launchAdminAction } from "@/lib/server/launch-admin-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let input: Record<string, unknown> = {};
  try { input = await request.clone().json() as Record<string, unknown>; }
  catch { return Response.json({ error: "Invalid brand update." }, { status: 400 }); }

  const keys = Object.keys(input);
  if (keys.length === 1 && keys[0] === "supportEmail" && typeof input.supportEmail === "string") {
    return launchAdminAction(request, id, "update-support", { email: input.supportEmail.trim() });
  }
  return legacyEditBrand(request);
}
