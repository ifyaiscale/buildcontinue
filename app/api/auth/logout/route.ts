import { json, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async () =>
  json(
    { authenticated: false },
    200,
    { "Set-Cookie": "limitless_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" },
  ),
);
