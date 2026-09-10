import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { HttpError } from "./errors";
import { requestSite, requireSitePath } from "./hosts";

export async function pageSite(path: string) {
  try {
    const site = requestSite({ headers: await headers(), url: process.env.APP_URL || "http://localhost:3000" });
    requireSitePath(site, path);
    return site;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
}
