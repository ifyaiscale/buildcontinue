import type { Config } from "@netlify/functions";
import { workerSignature } from "../../lib/server/worker-auth";

export default async () => {
  const origin = new URL(Netlify.env.get("APP_URL") ?? "");
  if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("Invalid worker origin.");
  const timestamp = String(Date.now());
  const response = await fetch(new URL("/.netlify/functions/payment-worker-background", origin), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { "x-worker-time": timestamp, "x-worker-signature": workerSignature(Netlify.env.get("SESSION_SECRET") ?? "", timestamp) },
  });
  if (response.status !== 202) throw new Error("Payment worker dispatch failed.");
};

export const config: Config = { schedule: "* * * * *" };
