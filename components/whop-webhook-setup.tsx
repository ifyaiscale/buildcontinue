"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, Webhook } from "lucide-react";
import { dashboardFetch } from "@/lib/client-api";
import type { AppState, Brand } from "@/lib/types";

type Result = { state: "idle" | "working" | "done" | "error"; message?: string };

async function responseJson(response: Response) {
  return response.json().catch(() => ({} as Record<string, unknown>));
}

export function WhopWebhookSetup() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await dashboardFetch("/api/state", { cache: "no-store" });
      const data = await responseJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not load brands.");
      setBrands((data as unknown as AppState).brands.filter(brand => ["chefings", "cozyinfants", "facejamas"].includes(brand.slug)));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load brands.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function provision(brand: Brand) {
    setResults(previous => ({ ...previous, [brand.id]: { state: "working" } }));
    try {
      const response = await dashboardFetch(`/api/brands/${encodeURIComponent(brand.id)}/whop-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await responseJson(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Webhook provisioning failed.");
      setResults(previous => ({ ...previous, [brand.id]: { state: "done", message: "Signed payment webhook configured." } }));
      return true;
    } catch (cause) {
      setResults(previous => ({ ...previous, [brand.id]: { state: "error", message: cause instanceof Error ? cause.message : "Webhook provisioning failed." } }));
      return false;
    }
  }

  async function provisionAll() {
    for (const brand of brands) {
      const ok = await provision(brand);
      if (!ok) break;
    }
  }

  const allDone = useMemo(() => brands.length > 0 && brands.every(brand => results[brand.id]?.state === "done"), [brands, results]);
  const busy = Object.values(results).some(result => result.state === "working");

  return <main style={{ minHeight: "100vh", background: "#080b14", color: "#f7f8ff", padding: "30px 18px 80px" }}>
    <div style={{ width: "min(900px,100%)", margin: "0 auto" }}>
      <a href="/launch-center" style={{ color: "#9ba5c5", textDecoration: "none", fontWeight: 750 }}>← Launch Center</a>
      <div style={{ margin: "34px 0 22px" }}>
        <div style={{ color: "#8b72ff", fontSize: 12, letterSpacing: ".15em", fontWeight: 900 }}>PAYMENT SECURITY</div>
        <h1 style={{ fontSize: "clamp(38px,7vw,68px)", lineHeight: .95, letterSpacing: "-.055em", margin: "8px 0 14px" }}>Provision Whop webhooks</h1>
        <p style={{ color: "#9ba5c5", maxWidth: 720, lineHeight: 1.65, margin: 0 }}>Limitless will create a dedicated signed <code>payment.succeeded</code> webhook for each brand and immediately encrypt the one-time signing secret. Public customer payments remain controlled by the separate launch gates.</p>
      </div>

      {error && <div role="alert" style={{ margin: "18px 0", padding: 16, border: "1px solid rgba(255,88,112,.35)", background: "rgba(255,88,112,.08)", borderRadius: 16, color: "#ffb1bd" }}>{error}</div>}

      <div style={{ display: "grid", gap: 14 }}>
        {loading ? <div style={{ padding: 30, color: "#9ba5c5" }}><LoaderCircle size={18} /> Loading connected brands…</div> : brands.map(brand => {
          const result = results[brand.id] || { state: "idle" as const };
          return <section key={brand.id} style={{ border: "1px solid #28314c", background: "#0e1321", borderRadius: 20, padding: 20, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div>
              <strong style={{ fontSize: 20 }}>{brand.name}</strong>
              <div style={{ color: "#8e98b8", marginTop: 4, fontSize: 13 }}>{brand.whop.status === "verified" ? "Whop connection verified" : "Whop connection needs verification"}</div>
              {result.message && <div style={{ marginTop: 8, maxWidth: 620, fontSize: 13, color: result.state === "error" ? "#ffb1bd" : "#72e2b0" }}>{result.message}</div>}
            </div>
            <button onClick={() => void provision(brand)} disabled={busy || brand.whop.status !== "verified" || result.state === "done"} style={{ border: 0, background: result.state === "done" ? "#174d3a" : "#7158ff", color: "#fff", borderRadius: 12, padding: "11px 15px", fontWeight: 850, cursor: busy || result.state === "done" ? "default" : "pointer" }}>
              {result.state === "working" ? <><LoaderCircle size={15} style={{ verticalAlign: "-3px", marginRight: 7 }} />Provisioning…</> : result.state === "done" ? <><CheckCircle2 size={15} style={{ verticalAlign: "-3px", marginRight: 7 }} />Configured</> : result.state === "error" ? <><RefreshCw size={15} style={{ verticalAlign: "-3px", marginRight: 7 }} />Retry</> : <><Webhook size={15} style={{ verticalAlign: "-3px", marginRight: 7 }} />Provision</>}
            </button>
          </section>;
        })}
      </div>

      {!loading && brands.length > 0 && <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button onClick={() => void provisionAll()} disabled={busy || allDone} style={{ border: 0, background: allDone ? "#174d3a" : "#fff", color: allDone ? "#fff" : "#111522", borderRadius: 14, padding: "13px 18px", fontWeight: 900, cursor: busy || allDone ? "default" : "pointer" }}>{allDone ? "All three configured" : busy ? "Provisioning…" : "Provision all three"}</button>
        {allDone ? <span style={{ color: "#72e2b0", fontSize: 13 }}><CheckCircle2 size={15} style={{ verticalAlign: "-3px", marginRight: 6 }} />Return to Launch Center for controlled purchases.</span> : <span style={{ color: "#8e98b8", fontSize: 13 }}><CircleAlert size={15} style={{ verticalAlign: "-3px", marginRight: 6 }} />If a key lacks <code>developer:manage_webhook</code>, provisioning stops safely and tells you which connection needs updating.</span>}
      </div>}
    </div>
  </main>;
}
