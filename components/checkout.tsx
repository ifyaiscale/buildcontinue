"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, LockKeyhole, Minus, Plus, ShoppingBag, Truck } from "lucide-react";
import type { Brand } from "@/lib/types";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const brandStyle = (brand: Brand) => ({ "--co-accent": /^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent : "#344b40" }) as CSSProperties;

function BrandHeader({ brand }: { brand: Brand }) {
  return <div className="co-brand"><span className="co-brand-mark">{brand.logoInitial}</span><span>{brand.name}</span></div>;
}

function ProductImage({ image, title }: { image?: string; title: string }) {
  return image ? <img src={image} alt={title} /> : <ShoppingBag aria-label={title} size={32} />;
}

export function CheckoutPreview({ brand }: { brand: Brand }) {
  const product = brand.products.find((item) => item.available);
  const shipping = product && product.price >= brand.freeShippingThreshold ? 0 : brand.shippingPrice;
  return <div className="checkout-preview" style={brandStyle(brand)}>
    <div className="co-preview-announcement">{brand.announcement || "Thoughtfully made. Just for you."}</div>
    <div className="co-preview-body">
      <div className="co-preview-details"><BrandHeader brand={brand} /><div className="co-preview-steps">Information <span>›</span> Shipping <span>›</span> Payment</div>
        <h3>{brand.checkoutTitle || "A little closer to yours."}</h3><p className="co-muted">A thoughtful checkout, from start to finish.</p>
        <div className="co-preview-section"><span className="co-preview-number">1</span><div><strong>Contact</strong><p>Email address</p></div></div>
        <div className="co-preview-section"><span className="co-preview-number">2</span><div><strong>Delivery</strong><p>Name and shipping address</p></div></div>
        <div className="co-preview-section"><span className="co-preview-number">3</span><div><strong>{brand.mode === "demo" ? "Test order" : "Payment"}</strong><p>{brand.mode === "demo" ? "Demo checkout · no charge" : "Continue to Whop to pay"}</p></div></div>
        <div className="co-preview-note"><LockKeyhole size={13} /> {brand.mode === "demo" ? "Preview only. No payment collected." : "Checkout layout preview"}</div>
      </div>
      <div className="co-preview-summary"><div className="co-preview-eyebrow">YOUR ORDER</div>{product ? <><div className="co-preview-image"><ProductImage image={product.image} title={product.title} /></div><div className="co-preview-product"><strong>{product.title}</strong><span>{money(product.price)}</span></div><p className="co-muted">Quantity 1</p><div className="co-preview-totals"><div><span>Subtotal</span><span>{money(product.price)}</span></div><div><span>Shipping</span><span>{shipping === 0 ? "Free" : money(shipping)}</span></div><div className="co-preview-total"><strong>Estimated total</strong><strong>{money(product.price + shipping)}</strong></div></div><p className="co-preview-tax">{brand.mode === "demo" ? "Taxes not calculated in demo." : "Final total shown at payment."}</p></> : <p className="co-muted">Add an available product to preview your order.</p>}</div>
    </div>
  </div>;
}

export function CheckoutPage({ slug }: { slug: string }) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBrand(null);
    setError("");
    fetch(`/api/checkout/${encodeURIComponent(slug)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "This checkout is unavailable.");
        return data as Brand;
      })
      .then(setBrand)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "We couldn't load this checkout."); });
    return () => controller.abort();
  }, [slug, attempt]);
  if (!brand) return <main className="checkout-page co-loading"><ShoppingBag size={30} /><h1>{error ? "Checkout unavailable" : "Getting things ready…"}</h1>{error ? <><p role="alert">{error}</p><button className="co-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></> : <p role="status">Loading your checkout</p>}<a className="co-back-link" href="/">Back to Limitless Checkout</a></main>;
  return <CheckoutForm key={brand.id} brand={brand} />;
}

function CheckoutForm({ brand }: { brand: Brand }) {
  const products = brand.products.filter((product) => product.available);
  const [productId, setProductId] = useState(products[0]?.id || "");
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ orderId: string; total: number } | null>(null);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const product = products.find((item) => item.id === productId);
  const subtotal = (product?.price || 0) * quantity;
  const shipping = subtotal >= brand.freeShippingThreshold ? 0 : brand.shippingPrice;
  const total = subtotal + shipping;
  const remaining = Math.max(0, brand.freeShippingThreshold - subtotal);
  const demo = brand.mode === "demo";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || submitting) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      const customer = Object.fromEntries(["email", "firstName", "lastName", "address", "city", "postalCode", "country"].map((key) => [key, String(form.get(key) || "").trim()]));
      const body = JSON.stringify({ items: [{ productId: product.id, quantity }], customer, mode: brand.mode });
      if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() };
      const response = await fetch(`/api/checkout/${encodeURIComponent(brand.slug)}`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": submission.current.key },
        body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your order couldn't be created. Please try again.");
      if (demo && result.mode === "demo" && typeof result.orderId === "string" && typeof result.total === "number" && Number.isFinite(result.total)) {
        setConfirmation({ orderId: result.orderId, total: result.total });
        submission.current = null;
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (!demo && typeof result.checkoutUrl === "string") {
        const url = new URL(result.checkoutUrl);
        if (url.protocol !== "https:" || (url.hostname !== "whop.com" && !url.hostname.endsWith(".whop.com")) || url.username || url.password || url.port) throw new Error("The payment link could not be verified. Please contact the brand before retrying.");
        window.location.assign(url.href);
      } else throw new Error("We couldn't verify the checkout response. Please contact the brand before retrying.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally { setSubmitting(false); }
  }

  return <main className="checkout-page" style={brandStyle(brand)}>
    {demo && <div className="co-demo-banner"><span>DEMO CHECKOUT</span> This is a test experience. No real payment is collected.</div>}
    {brand.announcement && <div className="co-announcement">{brand.announcement}</div>}
    <header className="co-header"><BrandHeader brand={brand} /><span className="co-header-label"><ShoppingBag size={15} /> {demo ? "Test checkout" : "Checkout"}</span></header>
    {confirmation ? <section className="co-confirmation" aria-live="polite" aria-atomic="true"><div className="co-success-icon"><CheckCircle2 size={34} /></div><div className="co-eyebrow">TEST ORDER CONFIRMED</div><h1>Looks good on you.</h1><p>Your test order for {brand.name} was created.<br />No payment was collected. No products will be shipped.</p><dl><div><dt>Order number</dt><dd>{confirmation.orderId}</dd></div><div><dt>Test order total</dt><dd>{money(confirmation.total)}</dd></div></dl><button className="co-button" onClick={() => setConfirmation(null)}><ArrowLeft size={16} /> Back to checkout</button><p className="co-powered">Powered by <strong>limitless checkout</strong></p></section> : <div className="co-layout">
      <section className="co-details"><div className="co-breadcrumb">Information <span>›</span> Delivery <span>›</span> {demo ? "Test order" : "Payment"}</div><h1>{brand.checkoutTitle || "A little closer to yours."}</h1><p className="co-intro">A few details, and we’ll take it from here.</p>
        <form onSubmit={submit} className="co-form"><fieldset disabled={submitting || !product}><legend><span className="co-step">1</span> Contact information</legend><label className="co-field">Email address<input type="email" name="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></label><p className="co-field-note">{demo ? "Use fictional details for this test order." : "For your order updates and receipt."}</p></fieldset>
          <fieldset disabled={submitting || !product}><legend><span className="co-step">2</span> Shipping address</legend><div className="co-field-row"><label className="co-field">First name<input name="firstName" autoComplete="given-name" placeholder="First name" required maxLength={80} /></label><label className="co-field">Last name<input name="lastName" autoComplete="family-name" placeholder="Last name" required maxLength={80} /></label></div><label className="co-field">Street address<input name="address" autoComplete="street-address" placeholder="Street address, apartment, suite" required maxLength={200} /></label><div className="co-field-row"><label className="co-field">City<input name="city" autoComplete="address-level2" placeholder="City" required maxLength={100} /></label><label className="co-field">Postal code<input name="postalCode" autoComplete="postal-code" placeholder="Postal code" required maxLength={20} /></label></div><label className="co-field">Country<select name="country" autoComplete="country" required defaultValue="US"><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option><option value="AU">Australia</option><option value="DE">Germany</option><option value="FR">France</option><option value="NL">Netherlands</option><option value="NZ">New Zealand</option></select></label></fieldset>
          <div className="co-delivery"><Truck size={19} /><div><strong>Standard shipping</strong><span>{demo ? "Simulated delivery · no items will ship" : "Shipping availability confirmed at payment"}</span></div><strong>{shipping === 0 ? "Free" : money(shipping)}</strong></div>
          <div className="co-payment-note"><LockKeyhole size={17} /><p>{demo ? "This is a test order. No card details or payment are needed." : "You’ll continue to Whop to securely complete your one-time payment."}</p></div>
          {error && <div className="co-error" role="alert">{error}</div>}
          <button className="co-button" type="submit" disabled={submitting || !product}>{submitting ? "Preparing your order…" : demo ? "Place test order (no charge)" : "Continue to secure payment"}<ArrowRight size={18} /></button>
          <p className="co-submit-note">{demo ? "Demo only. This does not create a paid Shopify order." : "Your order is not paid until payment is confirmed."}</p>
        </form>
        <footer className="co-footer">{brand.supportEmail && <a href={`mailto:${brand.supportEmail}`}>Need a hand? Contact us</a>}<span className="co-powered">Powered by <strong>limitless checkout</strong></span></footer>
      </section>
      <aside className="co-summary" aria-label="Order summary"><div className="co-summary-heading"><h2>Your order</h2><span>{quantity} {quantity === 1 ? "item" : "items"}</span></div>
        {product ? <><div className="co-hero-image"><ProductImage image={product.image} title={product.title} /><span className="co-image-label">{brand.name}</span></div><div className="co-product-heading"><div><h3>{product.title}</h3><p>{product.description}</p></div><strong>{money(product.price)}</strong></div>
          {products.length > 1 && <label className="co-field">Choose your product<select value={productId} onChange={(event) => setProductId(event.target.value)} disabled={submitting}>{products.map((item) => <option key={item.id} value={item.id}>{item.title} — {money(item.price)}</option>)}</select></label>}
          <div className="co-quantity-row"><span>Quantity</span><div className="co-quantity"><button type="button" aria-label="Decrease quantity" disabled={quantity <= 1 || submitting} onClick={() => setQuantity((value) => value - 1)}><Minus size={14} /></button><output aria-live="polite" aria-label="Quantity">{quantity}</output><button type="button" aria-label="Increase quantity" disabled={quantity >= 10 || submitting} onClick={() => setQuantity((value) => value + 1)}><Plus size={14} /></button></div></div>
          {brand.freeShippingThreshold > 0 && <div className="co-shipping-progress"><p>{remaining > 0 ? <><Truck size={15} /> You’re {money(remaining)} away from free shipping.</> : <><Check size={15} /> Your order qualifies for free shipping.</>}</p><div className="co-progress-track"><span style={{ width: `${Math.min(100, subtotal / brand.freeShippingThreshold * 100)}%` }} /></div></div>}
          <div className="co-totals"><div><span>Subtotal</span><span>{money(subtotal)}</span></div><div><span>Shipping</span><span className={shipping === 0 ? "co-free" : ""}>{shipping === 0 ? "Free" : money(shipping)}</span></div><div><span>Taxes</span><span>{demo ? "Not calculated in demo" : "Calculated at payment"}</span></div><div className="co-total"><strong>{demo ? "Test order total" : "Estimated total"}</strong><span><small>USD</small><strong>{money(total)}</strong></span></div></div><div className="co-summary-caption"><span className="co-caption-line" /><span>Good things are on their way{demo ? " — in preview." : "."}</span><span className="co-caption-line" /></div>
        </> : <div className="co-empty"><ShoppingBag size={32} /><h3>No products available</h3><p>This brand is still setting up its collection. Please check back soon.</p></div>}
      </aside>
    </div>}
  </main>;
}
