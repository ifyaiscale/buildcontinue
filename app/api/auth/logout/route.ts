import { json, route } from "@/lib/server/http";
import { sessionCookie } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async () =>
  json({ authenticated: false }, 200, { "Set-Cookie": sessionCookie(null) }),
);
