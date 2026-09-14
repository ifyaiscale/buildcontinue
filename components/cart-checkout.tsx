"use client";

import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole, Minus, Plus, ShoppingBag, Truck } from "lucide-react";
import { checkoutExperience, checkoutTotals } from "@/lib/checkout";
import type { Brand, CheckoutOptions, Product } from "@/lib/types";
import { CHECKOUT_CURRENCY, COUNTRY_NAMES, LAUNCH_COUNTRY_CODES } from "@/lib/markets";

export type HandoffCartItem = { productId: string; quantity: number };

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: CHECKOUT_CURRENCY }).format(value);

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

export function CartCheckoutPage({ brand, initialItems }: { brand: Brand; initialItems: HandoffCartItem[] }) {
  const experience = checkoutExperience(brand);
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(initialItems.map(item => [item.productId, item.quantity])));
  const [priority, setPriority] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ orderId: string; total: number } | null>(null);
  const submission = useRef<{ body: string; key: string } | null>(null);

  const lines = initialItems.map(item => ({ product: brand.products.find(product => product.id === item.productId), quantity: quantities[item.productId] ?? item.quantity }));
  const validLines = lines.filter((line): line is { product: Product; quantity: number } => Boolean(line.product));
  const cartValid = validLines.length === initialItems.length && validLines.every(line => line.product.available && line.quantity >= 1 && line.quantity <= 20);
  const pricedItems = validLines.map(line => ({ price: line.product.price, quantity: line.quantity }));
  const options: CheckoutOptions = { priority };
  const totals = checkoutTotals(brand, pricedItems, options);
  const itemCount = validLines.reduce((sum, line) => sum + line.quantity, 0);
  const demo = brand.mode === "demo";
  const returnUrl = brand.domain ? `https://${brand.domain}` : "/";

  function changeQuantity(productId: string, delta: number) {
    setQuantities(current => ({ ...current, [productId]: Math.max(1, Math.min(20, (current[productId] ?? 1) + delta)) }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cartValid || submitting || !demo) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      const customer = Object.fromEntries(["email", "firstName", "lastName", "address", "city", "postalCode", "country"].map((key) => [key, String(form.get(key) || "").trim()]));
      const items = validLines.map(line => ({ productId: line.product.id, quantity: line.quantity }));
      const body = JSON.stringify({ items, customer, mode: "demo", options });
      if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() };
      const response = await fetch(`/api/checkout/${encodeURIComponent(brand.slug)}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": submission.current.key }, body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your order couldn't be created. Please try again.");
      if (result.mode !== "demo" || typeof result.orderId !== "string" || typeof result.total !== "number" || !Number.isFinite(result.total)) throw new Error("We couldn't verify the checkout response. Return to the store before retrying.");
      setConfirmation({ orderId: result.orderId, total: result.total });
      submission.current = null;
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!cartValid) return <CartCheckoutError domain={brand.domain} />;

  return <main className="checkout-page" style={brandStyle(brand)}>
    <div className="co-demo-banner"><span>STOREFRONT CART CONNECTED</span> {demo ? "Demo checkout · no real payment yet." : "Live payment is not enabled on this page yet."}</div>
    {brand.announcement && <div className="co-announcement">{brand.announcement}</div>}
    <header className="co-header"><div className="co-brand"><span className="co-brand-mark">{brand.logoInitial}</span><span>{brand.name}</span></div><span className="co-header-label"><ShoppingBag size={17} /> {itemCount} {itemCount === 1 ? "item" : "items"}</span></header>
    {confirmation ? <section className="co-confirmation" aria-live="polite" aria-atomic="true"><div className="co-success-icon"><CheckCircle2 size={34} /></div><div className="co-eyebrow">TEST ORDER CONFIRMED</div><h1>Your cart made it through.</h1><p>The storefront cart was preserved through Limitless Checkout.<br />No payment was collected and no products will be shipped in demo mode.</p><dl><div><dt>Order number</dt><dd>{confirmation.orderId}</dd></div><div><dt>Test order total</dt><dd>{money(confirmation.total)}</dd></div></dl><a className="co-button" href={returnUrl}><ArrowLeft size={16} /> Return to {brand.name}</a></section> : <div className="co-layout">
      <section className="co-details"><nav aria-label="Checkout steps" className="co-breadcrumb"><span aria-current="step">Information</span><span>›</span> Delivery <span>›</span> Payment</nav><h1>{brand.checkoutTitle || "A little closer to yours."}</h1><p className="co-intro">Your cart came directly from {brand.name}. Prices shown here come from the connected Shopify catalog, not the storefront browser.</p>
        <form onSubmit={submit} className="co-form">
          <fieldset disabled={submitting || !demo}><legend>Contact</legend><label className="co-field">Email address<input type="email" name="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></label>{demo && <p className="co-field-note">Use fictional details while this checkout is in demo mode.</p>}</fieldset>
          <fieldset disabled={submitting || !demo}><legend>Delivery</legend><label className="co-field">Country / region<select name="country" autoComplete="country" required defaultValue="US">{LAUNCH_COUNTRY_CODES.map(code => <option key={code} value={code}>{COUNTRY_NAMES[code]}</option>)}</select></label><div className="co-field-row"><label className="co-field">First name<input name="firstName" autoComplete="given-name" placeholder="First name" required maxLength={80} /></label><label className="co-field">Last name<input name="lastName" autoComplete="family-name" placeholder="Last name" required maxLength={80} /></label></div><label className="co-field">Street address<input name="address" autoComplete="street-address" placeholder="Street address, apartment, suite" required maxLength={200} /></label><div className="co-field-row"><label className="co-field">City<input name="city" autoComplete="address-level2" placeholder="City" required maxLength={100} /></label><label className="co-field">Postal code<input name="postalCode" autoComplete="postal-code" placeholder="Postal code" required maxLength={20} /></label></div></fieldset>
          <fieldset disabled={submitting || !demo}><legend>Shipping method</legend><div className="co-delivery"><Truck size={18} /><div><strong>Standard shipping</strong><span>{experience.deliveryText}</span></div><strong>{totals.shipping === 0 ? "Free" : money(totals.shipping)}</strong></div>{experience.priorityEnabled && <label className="co-option"><input type="checkbox" checked={priority} onChange={event => setPriority(event.target.checked)} /><span><strong>{experience.priorityLabel}</strong><small>Optional · once per order</small></span><strong>+{money(experience.priorityPrice)}</strong></label>}</fieldset>
          <fieldset disabled><legend>Payment</legend><div className="co-payment-panel"><div className="co-payment-heading"><span><LockKeyhole size={18} /> Payment</span></div><div className="co-card-preview"><p>{demo ? "Payment remains disabled while the storefront-cart handoff is being verified." : "Live payment activation is still gated."}</p></div></div></fieldset>
          {!demo && <p className="co-error" role="alert">Live customer payment is still disabled. The cart handoff is connected, but payment activation remains gated.</p>}
          {error && <div className="co-error" role="alert">{error}</div>}
          <button className="co-button" type="submit" disabled={submitting || !demo}>{submitting ? "Creating your test order…" : `Place test order · ${money(totals.total)}`}<ArrowRight size={18} /></button><p className="co-submit-note"><LockKeyhole size={13} /> Cart preserved server-side. No card charged in demo mode.</p>
        </form><footer className="co-footer"><a href={returnUrl}>Return to {brand.name}</a><span className="co-powered">Powered by <strong>limitless checkout</strong></span></footer>
      </section>
      <aside className="co-summary" aria-label="Order summary"><div className="co-summary-sticky"><div className="co-summary-content"><div className="co-summary-heading"><h2>Your cart</h2><span>{itemCount} {itemCount === 1 ? "item" : "items"}</span></div>{validLines.map(({ product, quantity }) => <div key={product.id}><ProductLine product={product} quantity={quantity} /><div className="co-quantity-row"><span>Quantity</span><div className="co-quantity"><button type="button" aria-label={`Decrease ${product.title} quantity`} disabled={quantity <= 1 || submitting} onClick={() => changeQuantity(product.id, -1)}><Minus size={14} /></button><output aria-live="polite">{quantity}</output><button type="button" aria-label={`Increase ${product.title} quantity`} disabled={quantity >= 20 || submitting} onClick={() => changeQuantity(product.id, 1)}><Plus size={14} /></button></div></div></div>)}<div className="co-totals"><div><span>Subtotal</span><span>{money(totals.subtotal)}</span></div><div><span>Shipping</span><span>{totals.shipping === 0 ? "Free" : money(totals.shipping)}</span></div>{totals.priority > 0 && <div><span>{experience.priorityLabel}</span><span>{money(totals.priority)}</span></div>}<div className="co-tax-line"><span>Taxes</span><span>Calculated in the live quote stage</span></div><div className="co-total"><strong>{demo ? "Test order total" : "Order total"}</strong><span><small>USD</small><strong>{money(totals.total)}</strong></span></div></div><p className="co-summary-note">Product IDs and prices are revalidated by Limitless before order creation.</p></div></div></aside>
    </div>}
  </main>;
}
