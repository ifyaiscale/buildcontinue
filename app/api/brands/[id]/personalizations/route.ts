import { json, route } from "@/lib/server/http";
import { listFaceJamasFulfillmentArtwork } from "@/lib/server/personalization";
import { HttpError, requireCredentials } from "@/lib/server/security";
import { requestSite } from "@/lib/server/hosts";
import { store } from "@/lib/server/store";

const handler = route(async (request: Request) => {
  requireCredentials(request);
  if (requestSite(request).kind !== "admin") throw new HttpError(404, "Page not available on this checkout domain.");
  if (request.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const match = new URL(request.url).pathname.match(/^\/api\/brands\/([a-zA-Z0-9_-]+)\/personalizations$/);
  if (!match) throw new HttpError(404, "Brand not found.");
  const db = await store();
  const brand = await db.brand(match[1]);
  if (brand.slug !== "facejamas") throw new HttpError(404, "Personalization fulfillment is only available for FaceJamas.");
  return json({ items: await listFaceJamasFulfillmentArtwork(db) });
});

export { handler as GET };
