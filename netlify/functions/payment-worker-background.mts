import { validWorkerRequest } from "../../lib/server/worker-auth";
import { store } from "../../lib/server/store";
import { runPaymentJob } from "../../lib/server/payment-jobs";

export default async (request: Request) => {
  if (request.method !== "POST" || !validWorkerRequest(request.headers, Netlify.env.get("SESSION_SECRET") ?? "")) return;
  const db = await store();
  const deadline = Date.now() + 10 * 60_000;
  for (let count = 0; count < 100 && Date.now() < deadline; count++) {
    if (!await runPaymentJob(db)) break;
  }
};
