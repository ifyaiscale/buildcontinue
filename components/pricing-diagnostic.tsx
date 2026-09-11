"use client";

import { useRef, useState, type FormEvent } from "react";
import type { Brand } from "@/lib/types";
import { dashboardFetch } from "@/lib/client-api";
import { LAUNCH_COUNTRY_CODES, COUNTRY_NAMES } from "@/lib/markets";

type Calculation = {
  status: string;
  currency: "USD";
  shippingRates: { handle: string; title: string; amountCents: number }[];
  selectedShippingRateHandle: string | null;
  totals: { subtotalCents: number; shippingCents: number; taxCents: number; discountCents: number; totalCents: number; taxesIncluded: boolean };
  blockers: string[];
  warnings: { message: string }[];
};
const dollars = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function PricingDiagnostic({ brand }: { brand: Brand }) {
  const products = brand.products.filter(product => product.available && product.variantId);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [address, setAddress] = useState({ firstName: "", lastName: "", address1: "", city: "", provinceCode: "", zip: "", countryCode: "US" });
  const [result, setResult] = useState<Calculation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  function invalidate() { revision.current++; setResult(null); setError(""); }
  async function calculate(shippingRateHandle?: string) {
    const current = ++revision.current;
    setBusy(true); setError("");
    try {
      const response = await dashboardFetch(`/api/brands/${brand.id}/payment-quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        items: [{ productId, quantity }],
        shippingAddress: { ...address, provinceCode: address.provinceCode || undefined },
        ...(shippingRateHandle ? { shippingRateHandle } : {}),
      }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "The calculation could not be completed.");
      if (current === revision.current) setResult(next);
    } catch (error) {
      if (current === revision.current) { setResult(null); setError(error instanceof Error ? error.message : "The calculation could not be completed."); }
    } finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void calculate(); }
  const enabled = brand.shopify.status === "verified" && products.length > 0;
  return <section className="panel" style={{ padding: 24, marginTop: 20 }}>
    <h2>Check Shopify shipping and tax</h2>
    <p>Calculate a sample cart using this store’s current rates. This check creates no order and collects no payment.</p>
    {!enabled ? <p className="field-hint">Connect Shopify and import products to begin.</p> : <form onSubmit={submit} style={{ marginTop: 20 }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
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
        </div>
        <p className="field-hint">Requires the Shopify app’s write_draft_orders permission. All amounts are USD. Use a representative delivery address; the check does not save it in Limitless.</p>
        <button type="submit" className="button secondary">{busy ? "Calculating…" : "Get shipping rates"}</button>
      </fieldset>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {result && <div style={{ marginTop: 20 }} aria-live="polite">
        {result.blockers.length > 0 ? <div className="inline-error" role="alert">
          Shopify could not produce an accepted quote. {result.blockers.includes("no_shipping_rates") && "No shipping rate is available for this destination."}
          {result.warnings.map((warning, i) => <p key={i}>{warning.message}</p>)}
        </div> : <>
          <p>Select a shipping service to include shipping and tax in the total:</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {result.shippingRates.map(rate => <button type="button" className="button secondary" key={rate.handle} disabled={busy} aria-pressed={result.selectedShippingRateHandle === rate.handle} onClick={() => void calculate(rate.handle)}>{rate.title} · {dollars(rate.amountCents)}</button>)}
          </div>
          {result.status === "calculated" && <>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
              <dt>Merchandise subtotal</dt><dd>{dollars(result.totals.subtotalCents)}</dd>
              <dt>Shipping</dt><dd>{dollars(result.totals.shippingCents)}</dd>
              <dt>Tax{result.totals.taxesIncluded ? " (included)" : ""}</dt><dd>{dollars(result.totals.taxCents)}</dd>
              <dt><strong>Total (USD)</strong></dt><dd><strong>{dollars(result.totals.totalCents)}</strong></dd>
            </dl>
            <p className="field-hint">Compare this result with the same cart and address in Shopify. This diagnostic does not reserve inventory or enable payments.</p>
          </>}
        </>}
      </div>}
    </form>}
  </section>;
}
