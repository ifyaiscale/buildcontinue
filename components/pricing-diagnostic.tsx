"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Brand } from "@/lib/types";
import { dashboardFetch } from "@/lib/client-api";
import { LAUNCH_COUNTRY_CODES, COUNTRY_NAMES } from "@/lib/markets";
import { checkoutExperience } from "@/lib/checkout";

type Calculation = {
  status: string;
  currency: "USD";
  totals: { subtotalCents: number; priorityCents: number; shippingCents: number; taxCents: number; discountCents: number; totalCents: number; taxesIncluded: boolean };
};
const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const PERSONALIZATION_REF = /^pers_[0-9a-f-]{36}$/i;

export function PricingDiagnostic({ brand }: { brand: Brand }) {
  const products = brand.products.filter(product => product.available && product.variantId);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [priority, setPriority] = useState(false);
  const [personalizationRef, setPersonalizationRef] = useState("");
  const [address, setAddress] = useState({ firstName: "", lastName: "", address1: "", city: "", provinceCode: "", zip: "", countryCode: "US" });
  const [result, setResult] = useState<Calculation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [payment, setPayment] = useState<{ attemptId: string; purchaseUrl: string; totalCents: number } | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const [completion, setCompletion] = useState("");
  const paymentKey = useRef("");
  const revision = useRef(0);
  const needsPersonalization = brand.slug === "facejamas";
  const personalizationReady = !needsPersonalization || PERSONALIZATION_REF.test(personalizationRef.trim());

  function item() {
    return {
      productId,
      quantity,
      ...(needsPersonalization && personalizationRef.trim() ? { personalizationRef: personalizationRef.trim() } : {}),
    };
  }
  function invalidate() { revision.current++; setResult(null); setError(""); setPayment(null); setPaymentId(""); setCompletion(""); paymentKey.current = ""; }
  async function preparePayment() {
    setBusy(true); setError("");
    paymentKey.current ||= crypto.randomUUID();
    try {
      const response = await dashboardFetch(`/api/brands/${brand.id}/payment-start`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": paymentKey.current }, body: JSON.stringify({ email, items: [item()], shippingAddress: { ...address, provinceCode: address.provinceCode || undefined }, priority }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment preparation failed.");
      const url = new URL(data.purchaseUrl);
      if (url.protocol !== "https:" || !/(^|\.)whop\.com$/.test(url.hostname)) throw new Error("Unexpected payment link.");
      setPayment(data);
    } catch (error) { setError(error instanceof Error ? error.message : "Payment preparation failed."); }
    finally { setBusy(false); }
  }
  async function verifyPayment() {
    if (!payment) return;
    setBusy(true); setError("");
    try {
      const response = await dashboardFetch(`/api/brands/${brand.id}/payment-reconcile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId: payment.attemptId, paymentId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment verification failed.");
      setCompletion(data.state === "completed" ? `Paid Shopify order confirmed: ${data.orderId}` : "Payment needs review. Do not pay again.");
    } catch (error) { setError(error instanceof Error ? error.message : "Payment verification failed."); }
    finally { setBusy(false); }
  }
  async function calculate() {
    const current = ++revision.current;
    setBusy(true); setError("");
    try {
      const response = await dashboardFetch(`/api/brands/${brand.id}/launch-quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        items: [item()],
        shippingAddress: { ...address, provinceCode: address.provinceCode || undefined },
        priority,
      }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "The calculation could not be completed.");
      if (current === revision.current) setResult(next);
    } catch (error) {
      if (current === revision.current) { setResult(null); setError(error instanceof Error ? error.message : "The calculation could not be completed."); }
    } finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); if (personalizationReady) void calculate(); }
  const enabled = brand.shopify.status === "verified" && products.length > 0;
  return <section className="panel" style={{ padding: 24, marginTop: 20 }}>
    <h2>Check checkout total</h2>
    <p>Check current Shopify prices, availability and tax with free standard shipping. This check creates no order and collects no payment.</p>
    {!enabled ? <p className="field-hint">Connect Shopify and import products to begin.</p> : <form onSubmit={submit} style={{ marginTop: 20 }}>
      <fieldset disabled={busy || !!payment} style={{ border: 0, padding: 0, margin: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          <label className="field">Product<select required value={productId} onChange={e => { invalidate(); setProductId(e.target.value); }}>
            {products.map(product => <option value={product.id} key={product.id}>{product.title}</option>)}
          </select></label>
          <label className="field">Quantity<input required type="number" min={1} max={20} value={quantity} onChange={e => { invalidate(); setQuantity(Number(e.target.value)); }} /></label>
          {([ ["firstName", "First name"], ["lastName", "Last name"], ["address1", "Street address"], ["city", "City"], ["provinceCode", "State/province code"], ["zip", "Postal code"] ] as const).map(([key, label]) => <label className="field" key={key}>{label}
            <input value={address[key]} required={key !== "provinceCode" || ["US", "CA", "AU"].includes(address.countryCode)} maxLength={key === "address1" ? 200 : key === "provinceCode" ? 3 : key === "zip" ? 30 : 80} onChange={e => { invalidate(); setAddress({ ...address, [key]: e.target.value }); }} />
          </label>)}
          <label className="field">Destination<select value={address.countryCode} onChange={e => { invalidate(); setAddress({ ...address, countryCode: e.target.value, provinceCode: "", zip: "" }); }}>
            {LAUNCH_COUNTRY_CODES.map(code => <option value={code} key={code}>{COUNTRY_NAMES[code]}</option>)}
          </select></label>
          {needsPersonalization && <label className="field">FaceJamas personalization reference<input required value={personalizationRef} placeholder="pers_…" onChange={e => { invalidate(); setPersonalizationRef(e.target.value); }} /><span className="field-hint">Use the reference returned by a successful private FaceJamas photo upload. The controlled purchase must exercise the real personalization binding.</span></label>}
        </div>
        {checkoutExperience(brand).priorityEnabled && <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}><input type="checkbox" checked={priority} onChange={e => { invalidate(); setPriority(e.target.checked); }} />Optional priority processing · $4.99 per order</label>}
        <p className="field-hint">All amounts are USD. Standard shipping is free. Use a representative delivery address; the check does not save it in Limitless.</p>
        <button type="submit" className="button secondary" disabled={!personalizationReady}>{busy ? "Calculating…" : needsPersonalization && !personalizationReady ? "Add personalization reference" : "Calculate total"}</button>
      </fieldset>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {result && <div style={{ marginTop: 20 }} aria-live="polite">
          {result.status === "calculated" && <>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
              <dt>Merchandise subtotal</dt><dd>{dollars(result.totals.subtotalCents)}</dd>
              <dt>Shipping</dt><dd>{dollars(result.totals.shippingCents)}</dd>
              {result.totals.priorityCents > 0 && <><dt>Priority processing</dt><dd>{dollars(result.totals.priorityCents)}</dd></>}
              <dt>Tax{result.totals.taxesIncluded ? " (included)" : ""}</dt><dd>{dollars(result.totals.taxCents)}</dd>
              <dt><strong>Total (USD)</strong></dt><dd><strong>{dollars(result.totals.totalCents)}</strong></dd>
            </dl>
            <p className="field-hint">Compare this result with the same cart and address in Shopify. This diagnostic does not reserve inventory or enable payments.</p>
            <section style={{ marginTop: 24 }}>
              <h3>Administrator payment acceptance</h3>
              <p>Preparing payment reserves a Shopify draft and saves the delivery details securely. Payment testing must be enabled by the operator first. Opening the Whop link can lead to a real charge; check its environment and total before paying.</p>
              {!payment ? <><label className="field">Buyer email<input type="email" value={email} disabled={busy} onChange={e => { setEmail(e.target.value); paymentKey.current = ""; }} /></label><button className="button secondary" type="button" disabled={busy || !email || !personalizationReady} onClick={() => void preparePayment()}>Prepare payment</button></> : <>
                <p>Payment total: {dollars(payment.totalCents)}</p>
                <a href={payment.purchaseUrl} target="_blank" rel="noopener noreferrer">Open Whop checkout</a>
                <label className="field">Whop payment ID<input value={paymentId} disabled={busy} placeholder="pay_…" onChange={e => setPaymentId(e.target.value)} /></label>
                <button type="button" className="button secondary" disabled={busy || !paymentId || !!completion} onClick={() => void verifyPayment()}>Verify payment and complete Shopify order</button>
                {completion && <p role="status">{completion}</p>}
              </>}
            </section>
          </>}
      </div>}
    </form>}
  </section>;
}
