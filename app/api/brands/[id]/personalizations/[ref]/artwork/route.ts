import { json, route } from "@/lib/server/http";
import { openFaceJamasArtwork, PERSONALIZATION_REF_PATTERN } from "@/lib/server/personalization";
import { HttpError, rateLimit, requireCredentials } from "@/lib/server/security";
import { requestSite } from "@/lib/server/hosts";
import { store } from "@/lib/server/store";

const handler = route(async (request: Request) => {
  requireCredentials(request);
  if (requestSite(request).kind !== "admin") throw new HttpError(404, "Page not available on this checkout domain.");
  if (request.method !== "POST") throw new HttpError(405, "Method not allowed.");
  rateLimit("facejamas-artwork-open", 60, 60_000);
  const match = new URL(request.url).pathname.match(/^\/api\/brands\/([a-zA-Z0-9_-]+)\/personalizations\/(pers_[0-9a-f-]{36})\/artwork$/i);
  if (!match || !PERSONALIZATION_REF_PATTERN.test(match[2])) throw new HttpError(404, "Artwork not found.");
  const db = await store();
  const brand = await db.brand(match[1]);
  if (brand.slug !== "facejamas") throw new HttpError(404, "Artwork not found.");
  return json(await openFaceJamasArtwork(db, match[2]));
});

export { handler as POST };
