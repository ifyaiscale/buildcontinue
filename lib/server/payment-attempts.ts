import { createHash, randomUUID } from "node:crypto";
import type { Database } from "./database";
import { HttpError } from "./errors";

export type PaymentAttempt = {
  id: string; brandId: string; fingerprint: string; shopifyDomain: string; whopCompanyId: string;
  totalCents: number; currency: "USD"; expiresAt: number;
  state: "prepared" | "draft_pending" | "draft_ready" | "checkout_ready" | "paid" | "completed" | "review";
  draftId?: string; checkoutId?: string; paymentId?: string; orderId?: string;
  encryptedContext?: string; purchaseUrl?: string;
  completionLease?: { token: string; expiresAt: number };
};

// Every mutation uses the database's cross-process transaction lock. Provider calls
// happen outside these transactions; uncertain draft writes must be reconciled.
export class PaymentAttempts {
  constructor(private readonly db: Database) {}
  async get(brandId: string, id: string): Promise<PaymentAttempt> {
    const row = await this.db.get("SELECT data FROM payment_attempts WHERE id = ? AND brand_id = ?", id, brandId);
    if (!row) throw new HttpError(404, "Payment attempt not found.");
    return JSON.parse(row.data as string);
  }
  private async save(value: PaymentAttempt) {
    await this.db.run("UPDATE payment_attempts SET data = ? WHERE id = ? AND brand_id = ?", JSON.stringify(value), value.id, value.brandId);
    return value;
  }
  async prepare(input: { brandId: string; key: string; shopifyDomain: string; whopCompanyId: string; totalCents: number; cartFingerprint: string; encryptedContext?: string }, now = Date.now()) {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.key) || !Number.isSafeInteger(input.totalCents) || input.totalCents < 50 || input.totalCents > 10_000_000) throw new HttpError(422, "Invalid payment attempt.");
    const fingerprint = createHash("sha256").update(JSON.stringify([input.shopifyDomain, input.whopCompanyId, input.totalCents, input.cartFingerprint])).digest("hex");
    const key = `payment:${input.brandId}:${input.key}`;
    return this.db.transaction(async () => {
      const prior = await this.db.get("SELECT fingerprint, data FROM idempotency WHERE key = ?", key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new HttpError(409, "This payment key belongs to a different cart.");
        return this.get(input.brandId, JSON.parse(prior.data as string).id);
      }
      const attempt: PaymentAttempt = { id: `attempt_${randomUUID()}`, brandId: input.brandId, fingerprint, shopifyDomain: input.shopifyDomain, whopCompanyId: input.whopCompanyId, totalCents: input.totalCents, currency: "USD", expiresAt: now + 15 * 60_000, state: "prepared" };
      if (input.encryptedContext) attempt.encryptedContext = input.encryptedContext;
      await this.db.run("INSERT INTO payment_attempts (id, brand_id, data) VALUES (?, ?, ?)", attempt.id, attempt.brandId, JSON.stringify(attempt));
      await this.db.run("INSERT INTO idempotency (key, fingerprint, data) VALUES (?, ?, ?)", key, fingerprint, JSON.stringify({ id: attempt.id }));
      return attempt;
    });
  }
  async beginDraft(brandId: string, id: string, now = Date.now()) {
    return this.db.transaction(async () => {
      const attempt = await this.get(brandId, id);
      if (attempt.state !== "prepared" || attempt.expiresAt <= now) throw new HttpError(409, "Draft creation already started or this quote expired. Reconcile the existing attempt.");
      return this.save({ ...attempt, state: "draft_pending" });
    });
  }
  async bindDraft(brandId: string, id: string, draftId: string) {
    if (!/^gid:\/\/shopify\/DraftOrder\/[1-9]\d*$/.test(draftId)) throw new HttpError(422, "Invalid Shopify draft.");
    return this.db.transaction(async () => {
      const attempt = await this.get(brandId, id);
      if (attempt.draftId === draftId) return attempt;
      if (attempt.state !== "draft_pending" || attempt.draftId) throw new HttpError(409, "Payment attempt already has a different draft.");
      return this.save({ ...attempt, draftId, state: "draft_ready" });
    });
  }
  async bindCheckout(brandId: string, id: string, checkoutId: string, now = Date.now(), purchaseUrl?: string) {
    if (!/^ch_[A-Za-z0-9]+$/.test(checkoutId)) throw new HttpError(422, "Invalid Whop checkout.");
    return this.db.transaction(async () => {
      const attempt = await this.get(brandId, id);
      if (attempt.checkoutId === checkoutId) return attempt;
      if (attempt.state !== "draft_ready" || attempt.expiresAt <= now) throw new HttpError(409, "Payment attempt cannot accept a checkout.");
      return this.save({ ...attempt, checkoutId, purchaseUrl, state: "checkout_ready" });
    });
  }
  async acceptVerifiedPayment(brandId: string, id: string, paymentId: string, now = Date.now()) {
    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new HttpError(422, "Invalid Whop payment.");
    return this.db.transaction(async () => {
      const attempt = await this.get(brandId, id);
      const claimKey = `whop-payment:${attempt.whopCompanyId}:${paymentId}`;
      const claim = await this.db.get("SELECT data FROM idempotency WHERE key = ?", claimKey);
      if (claim && JSON.parse(claim.data as string).id !== id) throw new HttpError(409, "Payment already belongs to another attempt.");
      if (attempt.paymentId === paymentId) return attempt;
      if (!attempt.checkoutId || !attempt.draftId) throw new HttpError(409, "Payment attempt is not bound to a checkout and draft.");
      if (!claim) await this.db.run("INSERT INTO idempotency (key, fingerprint, data) VALUES (?, ?, ?)", claimKey, attempt.fingerprint, JSON.stringify({ id }));
      if (attempt.paymentId || attempt.state !== "checkout_ready" || attempt.expiresAt <= now) {
        // Preserve all payment claims for review; a second payment never fulfills twice.
        return this.save({ ...attempt, state: "review", paymentId: attempt.paymentId ?? paymentId });
      }
      return this.save({ ...attempt, paymentId, state: "paid" });
    });
  }
  async claimCompletion(brandId: string, id: string, now = Date.now()) {
    return this.db.transaction(async () => {
      const attempt = await this.get(brandId, id);
      if (attempt.state !== "paid" || attempt.completionLease && attempt.completionLease.expiresAt > now) throw new HttpError(409, "Order completion is already running or requires review.");
      return this.save({ ...attempt, completionLease: { token: randomUUID(), expiresAt: now + 120_000 } });
    });
  }
  async complete(brandId: string, id: string, orderId: string, leaseToken?: string) {
    if (!/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(orderId)) throw new HttpError(422, "Invalid Shopify order.");
    return this.db.transaction(async () => {
      const attempt = await this.get(brandId, id);
      if (attempt.orderId === orderId) return attempt;
      if (attempt.completionLease && attempt.completionLease.token !== leaseToken) throw new HttpError(409, "Order completion lease changed.");
      if (attempt.state !== "paid" || attempt.orderId) throw new HttpError(409, "This attempt cannot complete another order.");
      return this.save({ ...attempt, orderId, state: "completed" });
    });
  }
}
