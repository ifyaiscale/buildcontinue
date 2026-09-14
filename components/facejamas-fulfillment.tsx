"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Image as ImageIcon, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { dashboardFetch } from "@/lib/client-api";

type ArtworkItem = {
  personalizationRef: string;
  orderId: string;
  attachedAt: string | null;
  createdAt: string | null;
};

type OpenedArtwork = {
  personalizationRef: string;
  orderId: string;
  signedUrl: string;
  expiresAt: string;
};

async function api<T>(path: string, method = "GET"): Promise<T> {
  const response = await dashboardFetch(path, {
    method,
    ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The request could not be completed.");
  return result as T;
}

function date(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

export function FaceJamasFulfillment() {
  const [items, setItems] = useState<ArtworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<OpenedArtwork | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ items: ArtworkItem[] }>("/api/brands/facejamas/personalizations");
      setItems(result.items);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load FaceJamas fulfillment artwork.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function openArtwork(item: ArtworkItem) {
    setBusy(item.personalizationRef);
    setOpened(null);
    try {
      const result = await api<OpenedArtwork>(`/api/brands/facejamas/personalizations/${encodeURIComponent(item.personalizationRef)}/artwork`, "POST");
      setOpened(result);
      setError("");
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open private artwork.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#090d19", color: "#f7f8ff", padding: "32px 18px 70px" }}>
      <div style={{ width: "min(1080px, 100%)", margin: "0 auto" }}>
        <a href="/" style={{ color: "#9ea8c8", textDecoration: "none", fontWeight: 700 }}>← Limitless Checkout</a>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "end", flexWrap: "wrap", margin: "34px 0 20px" }}>
          <div>
            <div style={{ color: "#8e74ff", fontSize: 12, letterSpacing: ".14em", fontWeight: 900 }}>PRIVATE FULFILLMENT</div>
            <h1 style={{ fontSize: "clamp(34px, 6vw, 64px)", letterSpacing: "-.055em", margin: "8px 0 10px" }}>FaceJamas artwork</h1>
            <p style={{ color: "#9ea8c8", maxWidth: 680, lineHeight: 1.6, margin: 0 }}>Only artwork already bound to a completed Shopify order appears here. Opening a source image creates a one-time access capability and a signed link that expires after five minutes.</p>
          </div>
          <button onClick={() => void refresh()} disabled={loading} style={{ border: "1px solid #29314c", background: "#13192a", color: "#fff", borderRadius: 14, padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>
            <RefreshCw size={15} style={{ verticalAlign: "-2px", marginRight: 7 }} /> Refresh
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 24 }}>
          <div style={{ border: "1px solid #29314c", background: "#111728", borderRadius: 20, padding: 20 }}><ShieldCheck size={20} /><strong style={{ display: "block", marginTop: 10 }}>Private source files</strong><span style={{ color: "#9ea8c8", fontSize: 13 }}>No permanent public customer-photo URLs.</span></div>
          <div style={{ border: "1px solid #29314c", background: "#111728", borderRadius: 20, padding: 20 }}><ImageIcon size={20} /><strong style={{ display: "block", marginTop: 10 }}>Order-bound IDs</strong><span style={{ color: "#9ea8c8", fontSize: 13 }}>Every source is tied to the final Shopify order ID.</span></div>
          <div style={{ border: "1px solid #29314c", background: "#111728", borderRadius: 20, padding: 20 }}><ExternalLink size={20} /><strong style={{ display: "block", marginTop: 10 }}>5-minute access</strong><span style={{ color: "#9ea8c8", fontSize: 13 }}>Each artwork link is generated on demand and expires quickly.</span></div>
        </div>

        {error && <div role="alert" style={{ background: "rgba(255,85,110,.09)", border: "1px solid rgba(255,85,110,.3)", color: "#ffb0bd", padding: 16, borderRadius: 16, marginBottom: 18 }}>{error}</div>}
        {opened && <div style={{ background: "rgba(94,225,167,.08)", border: "1px solid rgba(94,225,167,.3)", padding: 16, borderRadius: 16, marginBottom: 18 }}>Artwork link created for <strong>{opened.personalizationRef}</strong>. <a href={opened.signedUrl} target="_blank" rel="noreferrer" style={{ color: "#7ee8bb" }}>Open again</a> before {date(opened.expiresAt)}.</div>}

        <div style={{ border: "1px solid #29314c", background: "#0f1423", borderRadius: 22, overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 34, textAlign: "center", color: "#9ea8c8" }}><LoaderCircle className="spin" size={22} /> Loading fulfillment artwork…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 34, textAlign: "center", color: "#9ea8c8" }}>No completed FaceJamas orders with artwork are bound yet.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
                <thead><tr style={{ textAlign: "left", color: "#8c96b6", fontSize: 12, letterSpacing: ".08em" }}><th style={{ padding: 16 }}>PERSONALIZATION</th><th style={{ padding: 16 }}>SHOPIFY ORDER</th><th style={{ padding: 16 }}>BOUND</th><th style={{ padding: 16 }}>SOURCE</th></tr></thead>
                <tbody>{items.map(item => <tr key={item.personalizationRef} style={{ borderTop: "1px solid #242b43" }}>
                  <td style={{ padding: 16, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>{item.personalizationRef}</td>
                  <td style={{ padding: 16, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>{item.orderId}</td>
                  <td style={{ padding: 16, color: "#9ea8c8", fontSize: 13 }}>{date(item.attachedAt || item.createdAt)}</td>
                  <td style={{ padding: 16 }}><button disabled={busy === item.personalizationRef} onClick={() => void openArtwork(item)} style={{ border: 0, background: "#7558ff", color: "white", borderRadius: 12, padding: "10px 13px", fontWeight: 850, cursor: "pointer" }}>{busy === item.personalizationRef ? "Opening…" : "Open artwork"}</button></td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
