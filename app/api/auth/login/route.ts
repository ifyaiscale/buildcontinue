import { body, json, route } from "@/lib/server/http";
import { issueAdminSession, rateLimit, sessionCookie } from "@/lib/server/security";
import { loginInput } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  rateLimit("login", 10, 15 * 60 * 1000);
  const { password } = loginInput.parse(await body(request));
  const token = await issueAdminSession(password);
  return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie(token) });
});
