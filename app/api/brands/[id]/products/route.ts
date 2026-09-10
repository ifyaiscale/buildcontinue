import { route } from "@/lib/server/http";
import { handleApi } from "@/lib/server/api";

export const runtime = "nodejs";
export const POST = route(handleApi);
