"use client";

import Script from "next/script";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, CheckCircle2, LockKeyhole, ShoppingBag, Truck } from "lucide-react";
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
type EmbeddedPaymentSession = {
  planId: string;
  sessionId: string;
  returnUrl: string;
  totalCents: number;
  currency: "USD";
  expiresAt: number;
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

function whopAccent(slug: string) {
  if (slug === "chefings") return "orange";
  if (slug === "cozyinfants") return "indigo";
  if (slug === "facejamas") return "violet";
  return "blue";
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

export function CartCheckoutPage({ brand, initialItems, cartToken, logoUrl }: { brand: Brand; initialItems: HandoffCartItem[]; cartToken: string; logoUrl?: string }) {
  const experience = checkoutExperience(brand);
  const [priority, setPriority] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [preparingPayment, setPreparingPayment] = useState(false);
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<AuthoritativeQuote | null>(null);
  const [quotedRequest, setQuotedRequest] = useState<CheckoutRequest | null>(null);
  const [paymentSession, setPaymentSession] = useState<EmbeddedPaymentSession | null>(null);
  const [formRevision, setFormRevision] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const quoteSequence = useRef(0);
  const paymentSequence = useRef(0);
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
    paymentSequence.current += 1;
    setQuote(null);
    setQuotedRequest(null);
    setPaymentSession(null);
    setPreparingPayment(false);
    setError("");
    setFormRevision(value => value + 1);
    paymentSubmission.current = null;
  }

  async function refreshExactTotal(form: HTMLFormElement) {
    if (!cartValid || !form.checkValidity()) return;
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
      setQuote(null); setQuotedRequest(null); setPaymentSession(null);
      setError(cause instanceof Error ? cause.message : "We couldn't calculate the exact checkout total.");
    } finally {
      if (sequence === quoteSequence.current) setQuoting(false);
    }
  }

  useEffect(() => {
    const form = formRef.current;
    if (!form || !cartValid || !form.checkValidity()) return;
    const timer = window.setTimeout(() => { void refreshExactTotal(form); }, 450);
    return () => window.clearTimeout(timer);
  }, [formRevision, priority, cartValid]);

  async function prepareEmbeddedPayment() {
    if (!quote?.paymentEnabled || !quotedRequest || preparingPayment || paymentSession) return;
    const sequence = ++paymentSequence.current;
    const reviewedTotalCents = quote.totals.totalCents;
    const body = JSON.stringify({ ...quotedRequest, confirmedTotalCents: reviewedTotalCents });
    if (paymentSubmission.current?.body !== body) paymentSubmission.current = { body, key: crypto.randomUUID() };
    setPreparingPayment(true);
    setError("");
    try {
      const response = await fetch(`/api/checkout/${encodeURIComponent(brand.slug)}/payment-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": paymentSubmission.current.key },
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Secure payment could not be prepared.");
      if (!Number.isSafeInteger(result.totalCents) || result.totalCents !== reviewedTotalCents || result.currency !== "USD") {
        setQuote(null); setQuotedRequest(null); setPaymentSession(null); paymentSubmission.current = null;
        throw new Error("The checkout total changed. Please wait for the total to update before paying.");
      }
      if (!/^plan_[A-Za-z0-9]+$/.test(String(result.planId || "")) || !/^ch_[A-Za-z0-9]+$/.test(String(result.sessionId || ""))) throw new Error("The payment provider returned an invalid embedded checkout session.");
      const paymentReturnUrl = new URL(String(result.returnUrl || ""));
      if (paymentReturnUrl.protocol !== "https:" || paymentReturnUrl.hostname !== window.location.hostname || paymentReturnUrl.pathname !== `/checkout/${brand.slug}`) throw new Error("The payment provider returned an invalid return URL.");
      if (sequence !== paymentSequence.current) return;
      setPaymentSession({
        planId: result.planId,
        sessionId: result.sessionId,
        returnUrl: paymentReturnUrl.toString(),
        totalCents: result.totalCents,
        currency: result.currency,
        expiresAt: result.expiresAt,
      });
    } catch (cause) {
      if (sequence !== paymentSequence.current) return;
      setPaymentSession(null);
      setError(cause instanceof Error ? cause.message : "Secure payment could not be prepared.");
    } finally {
      if (sequence === paymentSequence.current) setPreparingPayment(false);
    }
  }

  useEffect(() => {
    if (!quote?.paymentEnabled || !quotedRequest || paymentSession || preparingPayment) return;
    const timer = window.setTimeout(() => { void prepareEmbeddedPayment(); }, 250);
    return () => window.clearTimeout(timer);
  }, [quote, quotedRequest, paymentSession, preparingPayment]);

  if (!cartValid) return <CartCheckoutError domain={brand.domain} />;

  const displayedSubtotal = quote ? cents(quote.totals.subtotalCents) : money(estimate.subtotal);
  const displayedPriority = quote ? quote.totals.priorityCents : Math.round(estimate.priority * 100);
  const displayedTotal = quote ? cents(quote.totals.totalCents) : money(estimate.total);
  const shipping = quotedRequest?.shippingAddress;

  return <main className="checkout-page" style={brandStyle(brand)}>
    <Script id="whop-checkout-loader" src="https://js.whop.com/static/checkout/loader.js" strategy="afterInteractive" />
    {brand.announcement && <div className="co-announcement">{brand.announcement}</div>}
    <header className="co-header"><div className="co-brand">{logoUrl ? <img src={logoUrl} alt={brand.name} style={{ display: "block", maxWidth: 176, maxHeight: 50, width: "auto", height: "auto", objectFit: "contain" }} /> : <><span className="co-brand-mark">{brand.logoInitial}</span><span>{brand.name}</span></>}</div><span className="co-header-label"><LockKeyhole size={16} /> Secure checkout</span></header>
    <div className="co-layout">
      <section className="co-details"><nav aria-label="Checkout steps" className="co-breadcrumb"><span aria-current="step">Contact</span><span>›</span> Delivery <span>›</span> Payment</nav><h1>{brand.checkoutTitle || "Secure checkout"}</h1><p className="co-intro">Enter your delivery details and your exact shipping, tax and order total will update automatically.</p>
        <form ref={formRef} onSubmit={event => event.preventDefault()} onChange={invalidateQuote} className="co-form">
          <fieldset><legend>Contact</legend><label className="co-field">Email address<input type="email" name="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></label></fieldset>
          <fieldset><legend>Delivery</legend><label className="co-field">Country / region<select name="countryCode" autoComplete="country" required defaultValue="US">{LAUNCH_COUNTRY_CODES.map(code => <option key={code} value={code}>{COUNTRY_NAMES[code]}</option>)}</select></label><div className="co-field-row"><label className="co-field">First name<input name="firstName" autoComplete="given-name" placeholder="First name" required maxLength={80} /></label><label className="co-field">Last name<input name="lastName" autoComplete="family-name" placeholder="Last name" required maxLength={80} /></label></div><label className="co-field">Street address<input name="address1" autoComplete="address-line1" placeholder="Street address" required maxLength={200} /></label><label className="co-field">Apartment, suite, etc. (optional)<input name="address2" autoComplete="address-line2" placeholder="Apartment, suite, unit" maxLength={200} /></label><div className="co-field-row"><label className="co-field">City<input name="city" autoComplete="address-level2" placeholder="City" required maxLength={100} /></label><label className="co-field">State / province code<input name="provinceCode" autoComplete="address-level1" placeholder="ON / NY / NSW" maxLength={3} /></label></div><label className="co-field">Postal code<input name="zip" autoComplete="postal-code" placeholder="Postal code" required maxLength={30} /></label></fieldset>
          <fieldset><legend>Shipping method</legend><div className="co-delivery"><Truck size={18} /><div><strong>Free standard shipping</strong><span>{experience.deliveryText}</span></div><strong>Free</strong></div>{experience.priorityEnabled && <label className="co-option"><input type="checkbox" checked={priority} onChange={event => { setPriority(event.target.checked); invalidateQuote(); }} /><span><strong>{experience.priorityLabel}</strong><small>Optional · once per order</small></span><strong>+{money(experience.priorityPrice)}</strong></label>}</fieldset>
          {quoting && <div className="co-payment-panel"><div className="co-payment-heading"><span>Updating exact total…</span></div></div>}
          {quote && !quoting && <div className="co-payment-panel"><div className="co-payment-heading"><span><CheckCircle2 size={18} /> Total confirmed</span></div></div>}
          {quote && !quoting && !quote.paymentEnabled && <div className="co-payment-panel"><div className="co-payment-heading"><span><LockKeyhole size={18} /> Secure payment</span><div className="co-payment-marks"><span className="co-visa">VISA</span><span className="co-mastercard"><i></i><i></i></span><span className="co-amex">AMEX</span></div></div><div className="co-card-preview"><div><LockKeyhole size={15} /> Embedded card & wallet checkout is ready</div><div className="co-card-placeholder"><span>•••• •••• •••• ••••</span><span>MM / YY · CVC</span></div><p>Live payment fields are intentionally locked during no-charge launch QA. When live payments are enabled, Whop’s secure embedded card and wallet fields load here automatically without sending the customer away from {brand.name}.</p></div></div>}
          {preparingPayment && <div className="co-payment-panel"><div className="co-payment-heading"><span><LockKeyhole size={18} /> Preparing secure payment…</span></div></div>}
          {error && <div className="co-error" role="alert">{error}</div>}
          {paymentSession && quotedRequest && shipping && <div className="co-payment-panel"><div className="co-payment-heading"><span><LockKeyhole size={18} /> Payment</span></div><div
            key={`${paymentSession.sessionId}:${paymentSession.returnUrl}`}
            data-whop-checkout-plan-id={paymentSession.planId}
            data-whop-checkout-session={paymentSession.sessionId}
            data-whop-checkout-return-url={paymentSession.returnUrl}
            data-whop-checkout-theme="light"
            data-whop-checkout-theme-accent-color={whopAccent(brand.slug)}
            data-whop-checkout-hide-price="true"
            data-whop-checkout-hide-email="true"
            data-whop-checkout-hide-address="true"
            data-whop-checkout-collect-phone-numbers="false"
            data-whop-checkout-prefill-email={quotedRequest.email}
            data-whop-checkout-prefill-name={`${shipping.firstName} ${shipping.lastName}`.trim()}
            data-whop-checkout-prefill-address-name={`${shipping.firstName} ${shipping.lastName}`.trim()}
            data-whop-checkout-prefill-address-country={shipping.countryCode}
            data-whop-checkout-prefill-address-line1={shipping.address1}
            data-whop-checkout-prefill-address-line2={shipping.address2 || ""}
            data-whop-checkout-prefill-address-city={shipping.city}
            data-whop-checkout-prefill-address-state={shipping.provinceCode || ""}
            data-whop-checkout-prefill-address-postal-code={shipping.zip}
            style={{ width: "100%", minHeight: 360 }}
          ></div><p className="co-submit-note"><LockKeyhole size={13} /> Card and wallet details are encrypted and handled securely by our payment provider. They never pass through {brand.name} or Limitless servers.</p></div>}
          <div className="co-trust-row" aria-label="Checkout benefits"><span><LockKeyhole size={18} />Secure embedded payment</span><span><Truck size={18} />Free standard shipping</span><span><CheckCircle2 size={18} />Exact total automatically confirmed</span></div>
        </form><footer className="co-footer"><a href={returnUrl}>← Edit cart at {brand.name}</a>{brand.supportEmail && <a href={`mailto:${brand.supportEmail}`}>Need help? {brand.supportEmail}</a>}</footer>
      </section>
      <aside className="co-summary" aria-label="Order summary"><div className="co-summary-sticky"><div className="co-summary-content"><div className="co-summary-heading"><h2>Order summary</h2><span>{itemCount} {itemCount === 1 ? "item" : "items"}</span></div>{validLines.map(({ product, quantity }) => <ProductLine key={product.id} product={product} quantity={quantity} />)}<p className="co-summary-note">To change an item or quantity, return to the store.</p><div className="co-totals"><div><span>Merchandise</span><span>{displayedSubtotal}</span></div><div><span>Standard shipping</span><span>Free</span></div>{displayedPriority > 0 && <div><span>{experience.priorityLabel}</span><span>{cents(displayedPriority)}</span></div>}<div className="co-tax-line"><span>Taxes</span><span>{quote ? (quote.totals.taxesIncluded ? `Included (${cents(quote.totals.taxCents)})` : cents(quote.totals.taxCents)) : quoting ? "Updating…" : "Calculated from delivery address"}</span></div><div className="co-total"><strong>{quote ? "Total" : "Estimated total"}</strong><span><small>USD</small><strong>{displayedTotal}</strong></span></div></div><p className="co-summary-note">{quote ? `Price and tax verified at ${new Date(quote.calculatedAt).toLocaleTimeString()}.` : quoting ? "Confirming the exact total…" : "Enter your delivery details to confirm the exact total automatically."}</p></div></div></aside>
    </div>
  </main>;
}
