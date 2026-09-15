import { body, json, route } from "@/lib/server/http";
import { HttpError, rateLimit } from "@/lib/server/security";
import { loginInput } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_URL = "https://ifwljlzrhfmviwhsjhpp.supabase.co/functions/v1/limitless-admin-auth-v2";
const SESSION_SECONDS = 60 * 60 * 8;

export const POST = route(async (request: Request) => {
  rateLimit("login", 10, 15 * 60 * 1000);
  const { password } = loginInput.parse(await body(request));

  let response: Response;
  try {
    response = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", password }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(503, "Administrator sign-in service is temporarily unavailable.");
  }

  let result: { token?: string; error?: string } = {};
  try {
    result = await response.json() as { token?: string; error?: string };
  } catch {
    throw new HttpError(503, "Administrator sign-in service returned an invalid response.");
  }

  if (response.status === 401) throw new HttpError(401, "Incorrect password.");
  if (response.status === 429) throw new HttpError(429, "Too many sign-in attempts. Please try again later.");
  if (!response.ok || !result.token || result.token.length > 2048 || !result.token.includes(".")) {
    throw new HttpError(503, result.error || "Administrator sign-in service returned an invalid session.");
  }

  const cookie = `limitless_session=${result.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
  return json({ authenticated: true }, 200, { "Set-Cookie": cookie });
});
