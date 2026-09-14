import { z } from "zod";
import { approveLaunchPolicy, launchPolicyStatus } from "@/lib/server/launch-policies";
import { body, json, route } from "@/lib/server/http";
import { requestSite } from "@/lib/server/hosts";
import { HttpError, rateLimit, requireCredentials } from "@/lib/server/security";
import { store } from "@/lib/server/store";

const handler = route(async (request: Request) => {
  requireCredentials(request);
  if (requestSite(request).kind !== "admin") throw new HttpError(404, "Page not available on this checkout domain.");
  const match = new URL(request.url).pathname.match(/^\/api\/brands\/([a-zA-Z0-9_-]+)\/launch-policies$/);
  if (!match) throw new HttpError(404, "Brand not found.");
  const db = await store();
  await db.brand(match[1]);
  if (request.method === "GET") return json(await launchPolicyStatus(db, match[1]));
  if (request.method === "POST") {
    rateLimit("launch-policy-approval", 10, 60_000);
    const input = z.object({ acknowledge: z.literal(true) }).strict().parse(await body(request));
    return json(await approveLaunchPolicy(db, match[1], input.acknowledge), 201);
  }
  throw new HttpError(405, "Method not allowed.");
});

export { handler as GET, handler as POST };
