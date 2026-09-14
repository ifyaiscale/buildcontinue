import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "personalization-assets";
const MAX_BYTES = 10 * 1024 * 1024;
const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ORDERED_SOURCE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const RATE_LIMIT = 20;
const RATE_SALT = "facejamas-upload-v1";

function allowedOrigin(origin: string) {
  return origin === "https://facejamas.com" ||
    origin === "https://www.facejamas.com" ||
    origin === "https://limitlesscheckout.netlify.app" ||
    /^https:\/\/deploy-preview-\d+--limitlesscheckout\.netlify\.app$/.test(origin);
}
function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}
function json(data: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}
function hex(bytes: Uint8Array) { return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
function b64url(bytes: Uint8Array) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function digest(value: Uint8Array) { return new Uint8Array(await crypto.subtle.digest("SHA-256", value)); }
function sniff(bytes: Uint8Array, declared: string) {
  if (declared === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", type: declared };
  if (declared === "image/png" && bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value)) return { ext: "png", type: declared };
  if (declared === "image/webp" && bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0,4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8,12)) === "WEBP") return { ext: "webp", type: declared };
  return null;
}
async function ensureBucket(supabase: ReturnType<typeof createClient>) {
  const existing = await supabase.storage.getBucket(BUCKET);
  if (existing.data) return;
  const created = await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] });
  if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
}
async function clientHash(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
  return hex(await digest(new TextEncoder().encode(`${RATE_SALT}:${ip}`)));
}
async function deletePrivateSource(supabase: ReturnType<typeof createClient>, ref: string) {
  const files = await supabase.storage.from(BUCKET).list(`facejamas/${ref}`, { limit: 10 });
  if (files.error) return false;
  const paths = (files.data || []).filter(file => /^source\.(?:jpg|png|webp)$/.test(file.name)).map(file => `facejamas/${ref}/${file.name}`);
  if (!paths.length) return true;
  const removed = await supabase.storage.from(BUCKET).remove(paths);
  return !removed.error;
}
async function cleanupExpiredUploads(supabase: ReturnType<typeof createClient>) {
  const now = new Date().toISOString();
  const expired = await supabase.from("facejamas_upload_receipts")
    .select("ref")
    .lt("expires_at", now)
    .is("attempt_id", null)
    .is("order_id", null)
    .limit(10);
  if (!expired.error) {
    for (const row of expired.data || []) {
      const ref = typeof row.ref === "string" ? row.ref : "";
      if (!/^pers_[0-9a-f-]{36}$/i.test(ref)) continue;
      if (await deletePrivateSource(supabase, ref)) {
        await supabase.from("facejamas_upload_receipts").delete().eq("ref", ref).is("attempt_id", null).is("order_id", null);
      }
    }
  }

  const orderedCutoff = new Date(Date.now() - ORDERED_SOURCE_TTL_MS).toISOString();
  const ordered = await supabase.from("facejamas_upload_receipts")
    .select("ref")
    .not("order_id", "is", null)
    .not("order_bound_at", "is", null)
    .lt("order_bound_at", orderedCutoff)
    .is("source_deleted_at", null)
    .limit(10);
  if (!ordered.error) {
    for (const row of ordered.data || []) {
      const ref = typeof row.ref === "string" ? row.ref : "";
      if (!/^pers_[0-9a-f-]{36}$/i.test(ref)) continue;
      if (await deletePrivateSource(supabase, ref)) {
        await supabase.from("facejamas_upload_receipts").update({ source_deleted_at: now }).eq("ref", ref).not("order_id", "is", null).is("source_deleted_at", null);
      }
    }
  }

  const eventCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  await supabase.from("facejamas_upload_events").delete().lt("created_at", eventCutoff);
}

Deno.serve(async req => {
  const origin = req.headers.get("origin") || "";
  if (!allowedOrigin(origin)) return json({ error: "This upload must start from FaceJamas." }, 403, origin || "null");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES + 250_000) return json({ error: "Photo is too large. Maximum size is 10 MB." }, 413, origin);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("missing service configuration");
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await ensureBucket(supabase);
    await cleanupExpiredUploads(supabase);

    const who = await clientHash(req);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const countResult = await supabase.from("facejamas_upload_events").select("id", { count: "exact", head: true }).eq("client_hash", who).gte("created_at", since);
    if (countResult.error) throw countResult.error;
    if ((countResult.count || 0) >= RATE_LIMIT) return json({ error: "Upload limit reached. Please try again later." }, 429, origin);

    const form = await req.formData();
    const file = form.get("file");
    const consent = String(form.get("consent") || "");
    if (consent !== "true") return json({ error: "Confirm that you have permission to use this photo." }, 422, origin);
    if (!(file instanceof File)) return json({ error: "Choose a JPEG, PNG, or WebP photo." }, 422, origin);
    if (file.size < 1 || file.size > MAX_BYTES) return json({ error: "Photo is too large. Maximum size is 10 MB." }, 413, origin);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = sniff(bytes, file.type);
    if (!detected) return json({ error: "Photo must be a valid JPEG, PNG, or WebP file." }, 422, origin);

    const ref = `pers_${crypto.randomUUID()}`;
    const objectPath = `facejamas/${ref}/source.${detected.ext}`;
    const uploaded = await supabase.storage.from(BUCKET).upload(objectPath, bytes, { contentType: detected.type, cacheControl: "0", upsert: false });
    if (uploaded.error) throw uploaded.error;

    const proofBytes = crypto.getRandomValues(new Uint8Array(32));
    const proof = b64url(proofBytes);
    const proofHash = hex(await digest(new TextEncoder().encode(proof)));
    const sourceHash = hex(await digest(bytes));
    const expiresAt = new Date(Date.now() + RECEIPT_TTL_MS).toISOString();
    const receipt = await supabase.from("facejamas_upload_receipts").insert({ ref, proof_hash: proofHash, content_type: detected.type, size_bytes: bytes.length, sha256: sourceHash, expires_at: expiresAt });
    if (receipt.error) {
      await supabase.storage.from(BUCKET).remove([objectPath]);
      throw receipt.error;
    }
    const event = await supabase.from("facejamas_upload_events").insert({ client_hash: who });
    if (event.error) console.error("upload rate event could not be recorded");
    return json({ personalizationRef: ref, personalizationProof: proof, expiresAt }, 201, origin);
  } catch {
    return json({ error: "Your photo could not be stored securely. Please try again." }, 500, origin);
  }
});