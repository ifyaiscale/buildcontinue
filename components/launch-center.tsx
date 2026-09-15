"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, LoaderCircle, RefreshCw, ShieldCheck, Store, X } from "lucide-react";
import type { AppState, Brand } from "@/lib/types";
import { dashboardFetch } from "@/lib/client-api";

type PolicyStatus = {
  approved: boolean;
  approvedAt: string | null;
  supportContactConfigured: boolean;
  policyHash: string;
  policy: {
    version: number;
    brandSlug: string;
    support: { email: string; statement: string };
    shipping: { standard: string; priority: string; taxes: string };
    returns: { returns: string; cancellations: string };
    privacy: Record<string, string>;
    productSpecific: string[];
  };
};

type Readiness = {
  ready: boolean;
  acceptanceReady: boolean;
  checks: Record<string, boolean>;
  policy: { approved: boolean; approvedAt: string | null; policyHash: string };
  acceptance: { attemptId: string; orderId: string; totalCents: number; acceptedAt: string } | null;
};

type BrandLaunch = { brand: Brand; policy: PolicyStatus; readiness: Readiness };

type AcceptanceSession = { url: string; expiresAt: number };

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await dashboardFetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "The request could not be completed.") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return result as T;
}

const checkLabels: Record<string, string> = {
  paymentAcceptanceEnabled: "Administrator payment acceptance gate enabled",
  publicPaymentEnabled: "Public customer payment gate enabled",
  storefrontDomainConfigured: "Storefront domain configured",
  supportContactConfigured: "Monitored customer support email configured",
  launchPoliciesApproved: "Current customer policies reviewed and approved",
  shopifyVerified: "Shopify connection verified",
  whopVerified: "Whop company connection verified",
  whopWebhookConfigured: "Whop signed webhook configured",
  availableCatalog: "Available Shopify catalog imported",
  launchShippingPolicy: "Free shipping + $4.99 priority policy matches launch configuration",
  faceJamasPrivateMediaConfigured: "FaceJamas private artwork fulfillment configured",
  controlledAcceptanceCompleted: "Controlled real-payment acceptance completed and current",
};

function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function LaunchCenter() {
  const [items, setItems] = useState<BrandLaunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [support, setSupport] = useState<Record<string, string>>({});
  const [ack, setAck] = useState<Record<string, boolean>>({});
  const [attempt, setAttempt] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const state = await api<AppState>("/api/state");
      const launch = await Promise.all(state.brands.map(async brand => {
        const [policy, readiness] = await Promise.all([
          api<PolicyStatus>(`/api/brands/${brand.id}/launch-policies`),
          api<Readiness>(`/api/brands/${brand.id}/launch-readiness`),
        ]);
        return { brand, policy, readiness };
      }));
      setItems(launch);
      setSupport(Object.fromEntries(launch.map(item => [item.brand.id, item.brand.supportEmail || ""])));
      setError("");
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      setError(status === 401 ? "Sign in to Limitless Checkout first, then reopen the Launch Center." : err instanceof Error ? err.message : "Could not load launch readiness.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveSupport(item: BrandLaunch) {
    const email = (support[item.brand.id] || "").trim();
    setBusy(`support:${item.brand.id}`);
    try {
      await api(`/api/brands/${item.brand.id}`, "PATCH", { supportEmail: email });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save support contact."); }
    finally { setBusy(""); }
  }

  async function approve(item: BrandLaunch) {
    if (!ack[item.brand.id]) return;
    setBusy(`policy:${item.brand.id}`);
    try {
      await api(`/api/brands/${item.brand.id}/launch-policies`, "POST", { acknowledge: true });
      setAck(previous => ({ ...previous, [item.brand.id]: false }));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not approve launch policy."); }
    finally { setBusy(""); }
  }

  async function startAcceptance(item: BrandLaunch) {
    setBusy(`start:${item.brand.id}`);
    try {
      const session = await api<AcceptanceSession>(`/api/brands/${item.brand.id}/acceptance-session`, "POST");
      const url = new URL(session.url);
      if (url.protocol !== "https:" || !url.hostname.startsWith("checkout.")) throw new Error("Controlled acceptance returned an invalid checkout link.");
      window.location.assign(url.toString());
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start controlled acceptance."); }
    finally { setBusy(""); }
  }

  async function recordAcceptance(item: BrandLaunch) {
    const attemptId = (attempt[item.brand.id] || "").trim();
    setBusy(`accept:${item.brand.id}`);
    try {
      await api(`/api/brands/${item.brand.id}/launch-acceptance`, "POST", { attemptId });
      setAttempt(previous => ({ ...previous, [item.brand.id]: "" }));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not record controlled acceptance."); }
    finally { setBusy(""); }
  }

  async function activate(item: BrandLaunch) {
    if (!item.readiness.ready) return;
    setBusy(`live:${item.brand.id}`);
    try {
      await api(`/api/brands/${item.brand.id}/publish`, "POST", { mode: "live" });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not activate live checkout."); }
    finally { setBusy(""); }
  }

  const readyCount = useMemo(() => items.filter(item => item.readiness.ready).length, [items]);

  return (
    <main style={{ minHeight: "100vh", background: "#080b14", color: "#f7f8ff", padding: "30px 18px 80px" }}>
      <div style={{ width: "min(1180px,100%)", margin: "0 auto" }}>
        <a href="/" style={{ color: "#9ba5c5", textDecoration: "none", fontWeight: 750 }}>← Limitless Checkout</a>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 20, flexWrap: "wrap", margin: "34px 0 20px" }}>
          <div>
            <div style={{ color: "#8b72ff", fontSize: 12, letterSpacing: ".15em", fontWeight: 900 }}>CONTROLLED LAUNCH</div>
            <h1 style={{ fontSize: "clamp(38px,7vw,72px)", lineHeight: .94, letterSpacing: "-.06em", margin: "8px 0 14px" }}>Launch Center</h1>
            <p style={{ color: "#9ba5c5", maxWidth: 760, lineHeight: 1.65, margin: 0 }}>A brand goes live only when commerce infrastructure, customer-care policy, payment verification, and a controlled real purchase all agree. No single toggle can bypass the checklist.</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ padding: "10px 14px", border: "1px solid #28314c", borderRadius: 999, color: readyCount ? "#76e5b4" : "#a8b0ca", fontSize: 13, fontWeight: 800 }}>{readyCount}/{items.length || 3} launch-ready</span>
            <button onClick={() => void load()} disabled={loading} style={{ border: "1px solid #28314c", background: "#111725", color: "#fff", borderRadius: 14, padding: "11px 14px", fontWeight: 800, cursor: "pointer" }}><RefreshCw size={15} style={{ verticalAlign: "-2px", marginRight: 7 }} />Refresh</button>
          </div>
        </div>

        {error && <div role="alert" style={{ margin: "18px 0", padding: 16, border: "1px solid rgba(255,88,112,.35)", background: "rgba(255,88,112,.08)", borderRadius: 16, color: "#ffb1bd" }}>{error}</div>}
        {loading && !items.length ? <div style={{ padding: 45, textAlign: "center", color: "#9ba5c5" }}><LoaderCircle className="spin" /> Loading launch state…</div> : null}

        <div style={{ display: "grid", gap: 20 }}>
          {items.map(item => {
            const brand = item.brand;
            const p = item.policy.policy;
            const supportBusy = busy === `support:${brand.id}`;
            const policyBusy = busy === `policy:${brand.id}`;
            const startBusy = busy === `start:${brand.id}`;
            const acceptBusy = busy === `accept:${brand.id}`;
            const liveBusy = busy === `live:${brand.id}`;
            const privateAcceptanceArmed = item.readiness.checks.paymentAcceptanceEnabled === true && item.readiness.checks.publicPaymentEnabled !== true;
            const canStartAcceptance = item.readiness.acceptanceReady && privateAcceptanceArmed && !item.readiness.acceptance;
            return <section key={brand.id} style={{ border: `1px solid ${item.readiness.ready ? "rgba(88,225,164,.35)" : "#28314c"}`, background: "#0e1321", borderRadius: 28, overflow: "hidden" }}>
              <div style={{ padding: 24, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid #232b43" }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}><span style={{ width: 44, height: 44, display: "grid", placeItems: "center", borderRadius: 14, background: `${brand.accent}25`, color: brand.accent }}><Store size={20} /></span><div><strong style={{ fontSize: 22 }}>{brand.name}</strong><div style={{ color: "#8e98b8", fontSize: 13 }}>{brand.domain} · {brand.status}/{brand.mode}</div></div></div>
                <span style={{ display: "inline-flex", gap: 7, alignItems: "center", color: item.readiness.ready ? "#72e2b0" : "#ffbd72", fontWeight: 850, fontSize: 13 }}>{item.readiness.ready ? <Check size={16} /> : <CircleAlert size={16} />}{item.readiness.ready ? "Ready to activate" : "Launch checks incomplete"}</span>
              </div>

              <div style={{ padding: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 18 }}>
                <div style={{ border: "1px solid #242d46", borderRadius: 20, padding: 20, background: "#0b101c" }}>
                  <div style={{ fontSize: 12, color: "#8d97b7", letterSpacing: ".11em", fontWeight: 900 }}>1 · CUSTOMER SUPPORT</div>
                  <h3 style={{ margin: "8px 0 6px" }}>Monitored support inbox</h3>
                  <p style={{ color: "#929cbb", fontSize: 13, lineHeight: 1.55 }}>Use an address your team actually checks. Changing it later invalidates the controlled launch fingerprint.</p>
                  <input value={support[brand.id] ?? ""} onChange={event => setSupport(previous => ({ ...previous, [brand.id]: event.target.value }))} type="email" placeholder="support@yourdomain.com" style={{ width: "100%", boxSizing: "border-box", margin: "8px 0 10px", background: "#111827", border: "1px solid #303a57", color: "#fff", borderRadius: 12, padding: "12px 13px" }} />
                  <button onClick={() => void saveSupport(item)} disabled={supportBusy} style={{ border: 0, background: "#7158ff", color: "#fff", borderRadius: 12, padding: "10px 14px", fontWeight: 850, cursor: "pointer" }}>{supportBusy ? "Saving…" : "Save support contact"}</button>
                </div>

                <div style={{ border: "1px solid #242d46", borderRadius: 20, padding: 20, background: "#0b101c" }}>
                  <div style={{ fontSize: 12, color: "#8d97b7", letterSpacing: ".11em", fontWeight: 900 }}>2 · CUSTOMER POLICY</div>
                  <h3 style={{ margin: "8px 0 6px" }}>{item.policy.approved ? "Current policy approved" : "Review before launch"}</h3>
                  <div style={{ display: "grid", gap: 9, margin: "12px 0", color: "#a3acc8", fontSize: 13, lineHeight: 1.55 }}>
                    <div><strong style={{ color: "#fff" }}>Shipping:</strong> {p.shipping.standard} {p.shipping.priority}</div>
                    <div><strong style={{ color: "#fff" }}>Returns:</strong> {p.returns.returns}</div>
                    <div><strong style={{ color: "#fff" }}>Cancellation:</strong> {p.returns.cancellations}</div>
                    {Object.values(p.privacy).map((text, index) => <div key={index}><strong style={{ color: "#fff" }}>{index === 0 ? "Privacy:" : "Retention:"}</strong> {text}</div>)}
                    {p.productSpecific.map((text, index) => <div key={`specific-${index}`}><strong style={{ color: "#fff" }}>Product:</strong> {text}</div>)}
                  </div>
                  {item.policy.approved ? <div style={{ color: "#72e2b0", fontSize: 13 }}><ShieldCheck size={15} style={{ verticalAlign: "-3px", marginRight: 6 }} />Approved {date(item.policy.approvedAt)}</div> : <><label style={{ display: "flex", gap: 9, alignItems: "flex-start", color: "#c5cae0", fontSize: 13, margin: "12px 0" }}><input type="checkbox" checked={Boolean(ack[brand.id])} onChange={event => setAck(previous => ({ ...previous, [brand.id]: event.target.checked }))} /><span>I reviewed these customer-facing commitments and approve them for this brand.</span></label><button onClick={() => void approve(item)} disabled={!ack[brand.id] || policyBusy} style={{ border: 0, background: ack[brand.id] ? "#7158ff" : "#30364a", color: "#fff", borderRadius: 12, padding: "10px 14px", fontWeight: 850, cursor: ack[brand.id] ? "pointer" : "not-allowed" }}>{policyBusy ? "Approving…" : "Approve current policy"}</button></>}
                </div>
              </div>

              <div style={{ padding: "0 24px 24px" }}>
                <div style={{ border: "1px solid #242d46", borderRadius: 20, overflow: "hidden", background: "#0b101c" }}>
                  <div style={{ padding: 18, borderBottom: "1px solid #242d46" }}><strong>Launch checks</strong><div style={{ color: "#8f99b9", fontSize: 13, marginTop: 4 }}>A controlled real purchase remains required; no test/demo order can satisfy it.</div></div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>{Object.entries(item.readiness.checks).map(([key, ok]) => <div key={key} style={{ padding: "12px 16px", borderBottom: "1px solid #1d2439", display: "flex", gap: 9, alignItems: "center", color: ok ? "#dfe5f8" : "#aeb6cf", fontSize: 13 }}>{ok ? <Check size={15} color="#69dfa9" /> : <X size={15} color="#ff8b9d" />}<span>{checkLabels[key] || key}</span></div>)}</div>
                </div>
              </div>

              <div style={{ padding: "0 24px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
                <div style={{ border: "1px solid #242d46", borderRadius: 20, padding: 20, background: "#0b101c" }}>
                  <div style={{ fontSize: 12, color: "#8d97b7", letterSpacing: ".11em", fontWeight: 900 }}>3 · CONTROLLED ACCEPTANCE</div>
                  {item.readiness.acceptance ? <div style={{ marginTop: 10, color: "#72e2b0", fontSize: 13, lineHeight: 1.55 }}><strong>Current acceptance verified.</strong><br />{item.readiness.acceptance.attemptId}<br />{item.readiness.acceptance.orderId} · {money(item.readiness.acceptance.totalCents)}<br />{date(item.readiness.acceptance.acceptedAt)}</div> : <>
                    <p style={{ color: "#929cbb", fontSize: 13, lineHeight: 1.55 }}>The private acceptance button only works after the acceptance gate is deliberately armed while public payments remain off. It creates a 20-minute browser-only session, then sends you to the storefront to purchase normally.</p>
                    <button onClick={() => void startAcceptance(item)} disabled={!canStartAcceptance || startBusy} style={{ border: 0, background: canStartAcceptance ? "#7158ff" : "#30364a", color: "#fff", borderRadius: 12, padding: "10px 14px", fontWeight: 850, cursor: canStartAcceptance ? "pointer" : "not-allowed", marginBottom: 12 }}>{startBusy ? "Preparing private checkout…" : "Start private acceptance checkout"}</button>
                    <p style={{ color: "#929cbb", fontSize: 13, lineHeight: 1.55 }}>After the explicitly authorized real purchase completes and exactly one paid Shopify order exists, enter the immutable Limitless attempt ID shown on the confirmation page.</p>
                    <input value={attempt[brand.id] ?? ""} onChange={event => setAttempt(previous => ({ ...previous, [brand.id]: event.target.value }))} placeholder="attempt_…" style={{ width: "100%", boxSizing: "border-box", margin: "6px 0 10px", background: "#111827", border: "1px solid #303a57", color: "#fff", borderRadius: 12, padding: "12px 13px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} />
                    <button onClick={() => void recordAcceptance(item)} disabled={!attempt[brand.id]?.trim() || acceptBusy} style={{ border: 0, background: attempt[brand.id]?.trim() ? "#7158ff" : "#30364a", color: "#fff", borderRadius: 12, padding: "10px 14px", fontWeight: 850 }}>{acceptBusy ? "Verifying…" : "Record controlled acceptance"}</button>
                  </>}
                </div>
                <div style={{ border: `1px solid ${item.readiness.ready ? "rgba(88,225,164,.35)" : "#242d46"}`, borderRadius: 20, padding: 20, background: item.readiness.ready ? "rgba(88,225,164,.045)" : "#0b101c" }}>
                  <div style={{ fontSize: 12, color: "#8d97b7", letterSpacing: ".11em", fontWeight: 900 }}>4 · ACTIVATE</div>
                  <h3 style={{ margin: "8px 0 6px" }}>{item.readiness.ready ? "All launch gates are green." : "Still locked."}</h3>
                  <p style={{ color: "#929cbb", fontSize: 13, lineHeight: 1.55 }}>{item.readiness.ready ? "Activating changes this brand to live/live. The checkout continues to verify current Shopify totals and payment state on every order." : "This button stays disabled until every check above is true. Public payments cannot be enabled by this screen alone."}</p>
                  <button onClick={() => void activate(item)} disabled={!item.readiness.ready || liveBusy} style={{ border: 0, background: item.readiness.ready ? "#36b982" : "#30364a", color: "#fff", borderRadius: 12, padding: "11px 15px", fontWeight: 900, cursor: item.readiness.ready ? "pointer" : "not-allowed" }}>{liveBusy ? "Activating…" : "Enable live checkout"}</button>
                </div>
              </div>
            </section>;
          })}
        </div>
      </div>
    </main>
  );
}
