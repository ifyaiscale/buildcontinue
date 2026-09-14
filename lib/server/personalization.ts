import { createHash, timingSafeEqual } from "node:crypto";
import type { Brand } from "../types";
import type { Store } from "./store";
import { HttpError } from "./errors";

export const PERSONALIZATION_REF_PATTERN = /^pers_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PERSONALIZATION_PROOF_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;

export type PersonalizationCartFields = {
  personalizationRef?: string;
  personalizationProof?: string;
};

type Receipt = {
  ref: string;
  proofHash: string;
  expiresAt: string;
  attemptId?: string;
  orderId?: string;
};

function receiptTable(db: Store) {
  if (db.database.sqlite) {
    db.database.sqlite.exec(`CREATE TABLE IF NOT EXISTS facejamas_upload_receipts (
      ref TEXT PRIMARY KEY,
      proof_hash TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'image/jpeg',
      size_bytes INTEGER NOT NULL DEFAULT 1,
      sha256 TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      attempt_id TEXT,
      order_id TEXT,
      attached_at TEXT
    )`);
    return "facejamas_upload_receipts";
  }
  return "public.facejamas_upload_receipts";
}

function proofHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantHexEqual(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function parseReceipt(row: Record<string, unknown> | undefined): Receipt | undefined {
  if (!row) return undefined;
  if (typeof row.ref !== "string" || typeof row.proof_hash !== "string" || typeof row.expires_at !== "string") return undefined;
  return {
    ref: row.ref,
    proofHash: row.proof_hash,
    expiresAt: row.expires_at,
    ...(typeof row.attempt_id === "string" ? { attemptId: row.attempt_id } : {}),
    ...(typeof row.order_id === "string" ? { orderId: row.order_id } : {}),
  };
}

async function receipt(db: Store, ref: string) {
  const row = await db.database.get(
    `SELECT ref, proof_hash, expires_at, attempt_id, order_id FROM ${receiptTable(db)} WHERE ref = ?`,
    ref,
  );
  return parseReceipt(row);
}

export async function verifyFaceJamasCartPersonalizations(
  db: Store,
  brand: Brand,
  items: PersonalizationCartFields[],
  now = Date.now(),
) {
  const hasPersonalization = items.some(item => item.personalizationRef || item.personalizationProof);
  if (brand.slug !== "facejamas") {
    if (hasPersonalization) throw new HttpError(422, "Personalization references are only supported for FaceJamas.");
    return;
  }

  if (items.some(item => !item.personalizationRef || !item.personalizationProof)) {
    throw new HttpError(422, "Upload and confirm a photo for every FaceJamas item before checkout.");
  }

  const checked = new Map<string, string>();
  for (const item of items) {
    const ref = item.personalizationRef!;
    const proof = item.personalizationProof!;
    if (!PERSONALIZATION_REF_PATTERN.test(ref) || !PERSONALIZATION_PROOF_PATTERN.test(proof)) {
      throw new HttpError(422, "A FaceJamas photo upload proof is invalid. Upload the photo again.");
    }
    const previous = checked.get(ref);
    if (previous && previous !== proof) throw new HttpError(422, "A FaceJamas photo reference has conflicting proofs.");
    if (previous) continue;

    const stored = await receipt(db, ref);
    if (!stored || !constantHexEqual(stored.proofHash, proofHash(proof))) {
      throw new HttpError(422, "A FaceJamas photo upload could not be verified. Upload the photo again.");
    }
    if (Date.parse(stored.expiresAt) <= now || stored.orderId || stored.attemptId) {
      throw new HttpError(409, "That FaceJamas photo upload was already used or expired. Upload the photo again for this order.");
    }
    checked.set(ref, proof);
  }
}

export function personalizationRefs(items: Array<{ personalizationRef?: string }>) {
  return [...new Set(items.map(item => item.personalizationRef).filter((value): value is string => Boolean(value)))];
}

export function personalizationRefsFromDraftInput(lineItems: Array<Record<string, unknown>>) {
  const refs: string[] = [];
  for (const line of lineItems) {
    const attributes = line.customAttributes;
    if (!Array.isArray(attributes)) continue;
    for (const attribute of attributes) {
      if (!attribute || typeof attribute !== "object") continue;
      const item = attribute as Record<string, unknown>;
      if (item.key === "Personalization ID" && typeof item.value === "string" && PERSONALIZATION_REF_PATTERN.test(item.value)) refs.push(item.value);
    }
  }
  return [...new Set(refs)];
}

export async function claimFaceJamasPersonalizations(
  db: Store,
  brandId: string,
  refs: string[],
  attemptId: string,
  now = Date.now(),
) {
  if (!refs.length) return;
  await db.transaction(async () => {
    const table = receiptTable(db);
    for (const ref of new Set(refs)) {
      const stored = await receipt(db, ref);
      if (!stored || Date.parse(stored.expiresAt) <= now || stored.orderId) {
        throw new HttpError(409, "A FaceJamas personalization is no longer available. Start checkout again with a new photo upload.");
      }
      if (stored.attemptId && stored.attemptId !== attemptId) {
        throw new HttpError(409, "A FaceJamas personalization is already bound to another checkout. Upload the photo again for a new order.");
      }
      await db.database.run(
        `UPDATE ${table} SET attempt_id = ?, attached_at = COALESCE(attached_at, ?) WHERE ref = ? AND (attempt_id IS NULL OR attempt_id = ?)`,
        attemptId,
        new Date(now).toISOString(),
        ref,
        attemptId,
      );
      const verified = await receipt(db, ref);
      if (verified?.attemptId !== attemptId) throw new HttpError(409, "FaceJamas personalization could not be reserved for this checkout.");
    }
  });
}

export async function finalizeFaceJamasPersonalizations(
  db: Store,
  refs: string[],
  attemptId: string,
  orderId: string,
) {
  if (!refs.length) return;
  await db.transaction(async () => {
    const table = receiptTable(db);
    for (const ref of new Set(refs)) {
      const stored = await receipt(db, ref);
      if (!stored || stored.attemptId !== attemptId) throw new HttpError(409, "FaceJamas personalization binding needs reconciliation before fulfillment.");
      if (stored.orderId && stored.orderId !== orderId) throw new HttpError(409, "FaceJamas personalization is already bound to a different Shopify order.");
      await db.database.run(`UPDATE ${table} SET order_id = ? WHERE ref = ? AND attempt_id = ?`, orderId, ref, attemptId);
      const verified = await receipt(db, ref);
      if (verified?.orderId !== orderId) throw new HttpError(409, "FaceJamas personalization could not be bound to the Shopify order.");
    }
  });
}
