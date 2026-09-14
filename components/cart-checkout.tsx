"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole, ShoppingBag, Truck } from "lucide-react";
import { checkoutExperience, checkoutTotals } from "@/lib/checkout";
import type { Brand, CheckoutOptions, Product } from "@/lib/types";
import { CHECKOUT_CURRENCY, COUNTRY_NAMES, LAUNCH_COUNTRY_CODES } from "@/lib/markets";

export type HandoffCartItem = { productId: string; quantity: number };
type CheckoutRequest = {
  cartToken: string;
  email: string;
  priority: boolean;
  shippingAddress: {
    firstName: string; lastName: string; address1: string; address2?: string;
    city: string; provinceCode?: string; zip: string; countryCode: string;
  };
};
type AuthoritativeQuote = {
  status: "calculated";
  currency: "USD";
  paymentReady: false;
  paymentEnabled: boolean;
  calculatedAt: string;
  totals: {
    subtotalCents: number; priorityCents: number; shippingCents: number;
    taxCents: number; discountCents: number; totalCents: number; taxesIncluded: boolean;
  };
};

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: CHECKOUT_CURRENCY }).format(value);
const cents = (value: number) => money(value / 100);

function brandStyle(brand: Brand) {
  const accent = /^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent : "#344b40";
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return { "--co-accent": accent, "--co-accent-ink": luminance > 0.179 ? "#111111" : "#ffffff" } as CSSProperties;
}

function ProductImage({ product }: { product: Product }) {
  return product.image ? <img src={product.image} alt={product.title} /> : <ShoppingBag aria-label={product.title} size={26} />;
}

function ProductLine({ product, quantity }: { product: Product; quantity: number }) {
  return <div className="co-product-line"><div className="co-product-image"><ProductImage product={product} /><span className="co-product-count" aria-label={`Quantity ${quantity}`}>{quantity}</span></div><div className="co-product-info"><strong>{product.title}</strong><span>{product.description}</span></div><strong>{money(product.price * quantity)}</strong></div>;
}

export function CartCheckoutError({ domain }: { domain?: string }) {
  const href = domain ? `https://${domain}` : "/";
  return <main className="checkout-page co-loading"><ShoppingBag size={30} /><h1>Your cart needs a refresh</h1><p role="alert">This checkout link is invalid, expired, or a product changed. Return to the store and start checkout again.</p><a className="co-button" href={href}><ArrowLeft size={16} /> Return to store</a></main>;
}

function checkoutRequest(form: HTMLFormElement, cartToken: string, priority: boolean): CheckoutRequest {
  const data = new FormData(form);
  const provinceCode = String(data.get("provinceCode") || "").trim().toUpperCase();
  const address2 = String(data.get("address2") || "").trim();
  return {
    cartToken,
    email: String(data.get("email") || "").trim(),
    priority,
    shippingAddress: {
      firstName: String(data.get("firstName") || "").trim(),
      lastName: String(data.get("lastName") || "").trim(),
      address1: String(data.get("address1") || "").trim(),
      ...(address2 ? { address2 } : {}),
      city: String(data.get("city") || "").trim(),
      ...(provinceCode ? { provinceCode } : {}),
      zip: String(data.get("zip") || "").trim().toUpperCase(),
      countryCode: String(data.get("countryCode") || "US"),
    },
  };
}

export function CartCheckoutPage({ brand, initialItems, cartToken }: { brand: Brand; initialItems: HandoffCartItem[]; cartToken: string }) {
  const experience = checkoutExperience(brand);
  const [priority, setPriority] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<AuthoritativeQuote | null>(null);
  const [quotedRequest, setQuotedRequest] = useState<CheckoutRequest | null>(null);
  const [formRevision, setFormRevision] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const quoteSequence = useRef(0);
  const paymentSubmission = useRef<{ body: string; key: string } | null>(null);

  const lines = initialItems.map(item => ({ product: brand.products.find(product => product.id === item.productId), quantity: item.quantity }));
  const validLines = lines.filter((line): line is { product: Product; quantity: number } => Boolean(line.product));
  const cartValid = validLines.length === initialItems.length && validLines.every(line => line.product.available && line.quantity >= 1 && line.quantity <= 20);
  const options: CheckoutOptions = { priority };
  const estimate = checkoutTotals(brand, validLines.map(line => ({ price: line.product.price, quantity: line.quantity })), options);
  const itemCount = validLines.reduce((sum, line) => sum + line.quantity, 0);
  const returnUrl = brand.domain ? `https://${brand.domain}` : "/";

  function invalidateQuote() {
    quoteSequence.current += 1;
    setQuote(null);
    setQuotedRequest(null);
    setError("");
    setFormRevision(value => value + 1);
    paymentSubmission.current = null;
  }

  async function refreshExactTotal(form: HTMLFormElement) {
    if (!cartValid || paying || !form.checkValidity()) return;
    const sequence = ++quoteSequence.current;
    const request = checkoutRequest(form, cartToken, priority);
    setQuoting(true);
    setError("");
    try {
      const response = await fetch(`/api/checkout/${encodeURIComponent(brand.slug)}/quote`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We couldn't calculate the exact checkout total.");
      if (result.status !== "calculated" || result.currency !== "USD" || !result.totals || !Number.isSafeInteger(result.totals.totalCents)) throw new Error("The checkout total could not be verified.");
      if (sequence !== quoteSequence.current) return;
      setQuote(result as AuthoritativeQuote);
      setQuotedRequest(request);
    } catch (cause) {
      if (sequence !== quoteSequence.current) return;
      setQuote(null); setQuotedRequest(null);
      setError(cause instanceof Error ? cause.message : "We couldn't calculate the exact checkout total.");
    } finally {
      if (sequence === quoteSequence.current) setQuoting(false);
    }
  }

  useEffect(() => {
    const form = formRef.current;
    if (!form || !cartValid || paying || !form.checkValidity()) return;
    const timer = window.setTimeout(() => { void refreshExactTotal(form); }, 450);
    return () => window.clearTimeout(timer);
  }, [formRevision, priority, cartValid, paying]);

  async function continueToPayment() {
    if (!quote?.paymentEnabled || !quotedRequest || paying) return;
    const reviewedTotalCents = quote.totals.totalCents;
    const body = JSON.stringify({ ...quotedRequest, confirmedTotalCents: reviewedTotalCents });
    if (paymentSubmission.current?.body !== body) paymentSubmission.current = { body, key: crypto.randomUUID() };
    setPaying(true);
    setError("");
    try {
      const response = await fetch(`/api/checkout/${encodeURIComponent(brand.slug)}/payment-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": paymentSubmission.current.key },
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Secure payment could not be started.");
      if (!Number.isSafeInteger(result.totalCents) || result.totalCents !== reviewedTotalCents || result.currency !== "USD") {
        setQuote(null); setQuotedRequest(null); paymentSubmission.current = null;
        throw new Error("The checkout total changed. Please wait for the total to update before paying.");
      }
      const target = new URL(String(result.purchaseUrl || ""));
      if (target.protocol !== "https:" || !/(^|\.)whop\.com$/.test(target.hostname)) throw new Error("The payment provider returned an invalid checkout link.");
      window.location.assign(target.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Secure payment could not be started.");
      setPaying(false);
    }
  }

  if (!cartValid) return <CartCheckoutError domain={brand.domain} />;

  const displayedSubtotal = quote ? cents(quote.totals.subtotalCents) : money(estimate.subtotal);
  const displayedPriority = quote ? quote.totals.priorityCents : Math.round(estimate.priority * 100);
  const displayedTotal = quote ? cents(quote.totals.totalCents) : money(estimate.total);

  return <main className="checkout-page" style={brandStyle(brand)}>
    {brand.announcement && <div className="co-announcement">{brand.announcement}</div>}
    <header className="co-header"><div className="co-brand"><span className="co-brand-mark">{brand.logoInitial}</span><span>{brand.name}</span></div><span className="co-header-label"><LockKeyhole size={16} /> Secure checkout</span></header>
    <div className="co-layout">
      <section className="co-details"><nav aria-label="Checkout steps" className="co-breadcrumb"><span aria-current="step">Contact</span><span>›</span> Delivery</nav><h1>{brand.checkoutTitle || "Secure checkout"}</h1><p className="co-intro">Enter your delivery details and your exact shipping, tax and order total will update automatically.</p>
        <form ref={formRef} onSubmit={event => event.preventDefault()} onChange={invalidateQuote} className="co-form">
          <fieldset disabled={paying}><legend>Contact</legend><label className="co-field">Email address<input type="email" name="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></label></fieldset>
          <fieldset disabled={paying}><legend>Delivery</legend><label className="co-field">Country / region<select name="countryCode" autoComplete="country" required defaultValue="US">{LAUNCH_COUNTRY_CODES.map(code => <option key={code} value={code}>{COUNTRY_NAMES[code]}</option>)}</select></label><div className="co-field-row"><label className="co-field">First name<input name="firstName" autoComplete="given-name" placeholder="First name" required maxLength={80} /></label><label className="co-field">Last name<input name="lastName" autoComplete="family-name" placeholder="Last name" required maxLength={80} /></label></div><label className="co-field">Street address<input name="address1" autoComplete="address-line1" placeholder="Street address" required maxLength={200} /></label><label className="co-field">Apartment, suite, etc. (optional)<input name="address2" autoComplete="address-line2" placeholder="Apartment, suite, unit" maxLength={200} /></label><div className="co-field-row"><label className="co-field">City<input name="city" autoComplete="address-level2" placeholder="City" required maxLength={100} /></label><label className="co-field">State / province code<input name="provinceCode" autoComplete="address-level1" placeholder="ON / NY / NSW" maxLength={3} /></label></div><label className="co-field">Postal code<input name="zip" autoComplete="postal-code" placeholder="Postal code" required maxLength={30} /></label></fieldset>
          <fieldset disabled={paying}><legend>Shipping method</legend><div className="co-delivery"><Truck size={18} /><div><strong>Free standard shipping</strong><span>{experience.deliveryText}</span></div><strong>Free</strong></div>{experience.priorityEnabled && <label className="co-option"><input type="checkbox" checked={priority} onChange={event => { setPriority(event.target.checked); invalidateQuote(); }} /><span><strong>{experience.priorityLabel}</strong><small>Optional · once per order</small></span><strong>+{money(experience.priorityPrice)}</strong></label>}</fieldset>
          {quoting && <div className="co-payment-panel"><div className="co-payment-heading"><span>Updating exact total…</span></div></div>}
          {quote && !quoting && <div className="co-payment-panel"><div className="co-payment-heading"><span><CheckCircle2 size={18} /> Total confirmed</span></div></div>}
          {error && <div className="co-error" role="alert">{error}</div>}
          {quote?.paymentEnabled && <><button className="co-button" type="button" onClick={continueToPayment} disabled={paying}>{paying ? "Opening secure payment…" : `Pay securely · ${cents(quote.totals.totalCents)}`}<ArrowRight size={18} /></button><p className="co-submit-note"><LockKeyhole size={13} /> Payment details are entered on Whop's secure hosted payment page.</p></>}
          <div className="co-trust-row" aria-label="Checkout benefits"><span><LockKeyhole size={18} />Secure hosted payment</span><span><Truck size={18} />Free standard shipping</span><span><CheckCircle2 size={18} />Exact total automatically confirmed</span></div>
        </form><footer className="co-footer"><a href={returnUrl}>← Edit cart at {brand.name}</a>{brand.supportEmail && <a href={`mailto:${brand.supportEmail}`}>Need help? {brand.supportEmail}</a>}<span className="co-powered">Powered by <strong>Limitless Checkout</strong></span></footer>
      </section>
      <aside className="co-summary" aria-label="Order summary"><div className="co-summary-sticky"><div className="co-summary-content"><div className="co-summary-heading"><h2>Order summary</h2><span>{itemCount} {itemCount === 1 ? "item" : "items"}</span></div>{validLines.map(({ product, quantity }) => <ProductLine key={product.id} product={product} quantity={quantity} />)}<p className="co-summary-note">To change an item or quantity, return to the store.</p><div className="co-totals"><div><span>Merchandise</span><span>{displayedSubtotal}</span></div><div><span>Standard shipping</span><span>Free</span></div>{displayedPriority > 0 && <div><span>{experience.priorityLabel}</span><span>{cents(displayedPriority)}</span></div>}<div className="co-tax-line"><span>Taxes</span><span>{quote ? (quote.totals.taxesIncluded ? `Included (${cents(quote.totals.taxCents)})` : cents(quote.totals.taxCents)) : quoting ? "Updating…" : "Calculated from delivery address"}</span></div><div className="co-total"><strong>{quote ? "Total" : "Estimated total"}</strong><span><small>USD</small><strong>{displayedTotal}</strong></span></div></div><p className="co-summary-note">{quote ? `Price and tax verified at ${new Date(quote.calculatedAt).toLocaleTimeString()}.` : quoting ? "Confirming the exact total…" : "Enter your delivery details to confirm the exact total automatically."}</p></div></div></aside>
    </div>
  </main>;
}
