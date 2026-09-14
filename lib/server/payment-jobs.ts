import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import { HttpError } from "./errors";
import { reconcilePayment } from "./payment-service";

export type PaymentJob = {
  id: string; brandId: string; attemptId: string; paymentId: string;
  status: "pending" | "running" | "completed" | "review";
  tries: number; nextAt: number; lease?: string; leaseUntil?: number;
};

// Uses the existing private inbox table; payment jobs are distinct from event IDs.
export async function enqueuePayment(db: Store, brandId: string, reference: { attemptId: string; paymentId: string }, now = Date.now()) {
  const id = `payment-job:${brandId}:${reference.paymentId}`;
  return db.transaction(async () => {
    const row = await db.database.get("SELECT data FROM webhook_events WHERE id = ?", id);
    if (row) {
      const existing: PaymentJob = JSON.parse(String(row.data));
      if (existing.attemptId !== reference.attemptId) throw new HttpError(409, "Payment notification conflicts with its saved attempt.");
      return existing;
    }
    const job: PaymentJob = { id, brandId, ...reference, status: "pending", tries: 0, nextAt: now };
    await db.database.run("INSERT INTO webhook_events (id, brand_id, data) VALUES (?, ?, ?)", id, brandId, JSON.stringify(job));
    return job;
  });
}

export async function runPaymentJob(db: Store, reconcile = reconcilePayment, now = Date.now()) {
  const job = await db.transaction(async () => {
    const rows = await db.database.all("SELECT data FROM webhook_events WHERE id LIKE 'payment-job:%'");
    const due = rows.map(row => JSON.parse(String(row.data)) as PaymentJob)
      .filter(item => (item.status === "pending" && item.nextAt <= now) || (item.status === "running" && (item.leaseUntil ?? 0) <= now))
      .sort((a, b) => a.nextAt - b.nextAt)[0];
    if (!due) return null;
    const claimed: PaymentJob = { ...due, status: "running", tries: due.tries + 1, lease: randomUUID(), leaseUntil: now + 180_000 };
    await db.database.run("UPDATE webhook_events SET data = ? WHERE id = ?", JSON.stringify(claimed), claimed.id);
    return claimed;
  });
  if (!job) return false;
  let status: PaymentJob["status"] = "pending";
  try {
    const result = await reconcile(db, job.brandId, job.attemptId, job.paymentId);
    status = result.state === "completed" ? "completed" : "review";
  } catch {
    // Never save provider errors, which can contain customer data or secrets.
    if (job.tries >= 20) status = "review";
  }
  await db.transaction(async () => {
    const row = await db.database.get("SELECT data FROM webhook_events WHERE id = ?", job.id);
    const current: PaymentJob = JSON.parse(String(row!.data));
    if (current.lease !== job.lease) return;
    const updated: PaymentJob = { ...current, status, nextAt: now + Math.min(3600_000, 60_000 * 2 ** Math.min(job.tries - 1, 6)) };
    delete updated.lease; delete updated.leaseUntil;
    await db.database.run("UPDATE webhook_events SET data = ? WHERE id = ?", JSON.stringify(updated), job.id);
    if (status === "review") await db.addActivity(`Payment ${job.paymentId} requires order reconciliation. Do not request another payment.`, "order", job.brandId);
  });
  return true;
}
