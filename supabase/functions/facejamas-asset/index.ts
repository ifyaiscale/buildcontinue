import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "personalization-assets";
const TOKEN = /^[A-Za-z0-9_-]{40,100}$/;

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function hex(bytes: Uint8Array) { return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
async function hash(value: string) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }

Deno.serve(async req => {
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);
  try {
    const body = await req.json();
    const token = typeof body?.token === "string" ? body.token : "";
    if (!TOKEN.test(token)) return response({ error: "Artwork access token is invalid." }, 422);
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("missing service configuration");
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const tokenHash = await hash(token);
    const now = new Date().toISOString();
    const consumed = await supabase.from("facejamas_asset_access")
      .update({ consumed_at: now })
      .eq("token_hash", tokenHash)
      .is("consumed_at", null)
      .gt("expires_at", now)
      .select("ref")
      .maybeSingle();
    if (consumed.error) throw consumed.error;
    const ref = consumed.data?.ref;
    if (typeof ref !== "string") return response({ error: "Artwork access token expired or was already used." }, 410);
    const files = await supabase.storage.from(BUCKET).list(`facejamas/${ref}`, { limit: 10 });
    if (files.error) throw files.error;
    const source = (files.data || []).find(file => /^source\.(jpg|png|webp)$/.test(file.name));
    if (!source) return response({ error: "Artwork source could not be resolved." }, 404);
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(`facejamas/${ref}/${source.name}`, 300);
    if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error("missing signed url");
    return response({ signedUrl: signed.data.signedUrl, expiresIn: 300, personalizationRef: ref });
  } catch {
    return response({ error: "Private artwork could not be opened." }, 500);
  }
});
