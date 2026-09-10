"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Clock3, CreditCard, LockKeyhole, Minus, Plus, ShoppingBag, Star, Truck } from "lucide-react";
import { checkoutExperience, checkoutTotals } from "@/lib/checkout";
import type { Brand, CheckoutOptions, OrderBreakdown, Product } from "@/lib/types";
import { CHECKOUT_CURRENCY, COUNTRY_NAMES, LAUNCH_COUNTRY_CODES } from "@/lib/markets";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: CHECKOUT_CURRENCY }).format(value);
const brandStyle = (brand: Brand) => {
  const accent = /^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent : "#344b40";
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return { "--co-accent": accent, "--co-accent-ink": luminance > 0.179 ? "#111111" : "#ffffff" } as CSSProperties;
};

function BrandHeader({ brand }: { brand: Brand }) {
  return <div className="co-brand"><span className="co-brand-mark">{brand.logoInitial}</span><span>{brand.name}</span></div>;
}

function ProductImage({ image, title }: { image?: string; title: string }) {
  return image ? <img src={image} alt={title} /> : <ShoppingBag aria-label={title} size={26} />;
}

function ProductLine({ product, quantity }: { product: Product; quantity: number }) {
  return <div className="co-product-line"><div className="co-product-image"><ProductImage image={product.image} title={product.title} /><span className="co-product-count" aria-label={`Quantity ${quantity}`}>{quantity}</span></div><div className="co-product-info"><strong>{product.title}</strong><span>{product.description}</span></div><strong>{money(product.price * quantity)}</strong></div>;
}

function PaymentMarks() {
  return <div className="co-payment-marks" aria-label="Payment method design preview: Visa, Mastercard, American Express"><span className="co-visa">VISA</span><span className="co-mastercard"><i /><i /><span className="co-sr-only">Mastercard</span></span><span className="co-amex">AMEX</span></div>;
}

function ExpressPayment({ preview = false }: { preview?: boolean }) {
  return <div className="co-express"><div className="co-express-label">Express checkout <span>DESIGN PREVIEW</span></div><div className="co-express-buttons">{preview ? <><div className="co-wallet co-apple">Apple Pay</div><div className="co-wallet co-google"><span>G</span> Google Pay</div></> : <><button type="button" disabled className="co-wallet co-apple" aria-label="Apple Pay, unavailable in demo">Apple Pay</button><button type="button" disabled className="co-wallet co-google" aria-label="Google Pay, unavailable in demo"><span>G</span> Google Pay</button></>}</div><p>Demo only · express payments are not connected.</p><div className="co-divider"><span />or continue with a test order<span /></div></div>;
}

function PaymentPanel({ brand }: { brand: Brand }) {
  const experience = checkoutExperience(brand);
  return <div className="co-payment-panel"><div className="co-payment-heading"><span><CreditCard size={18} /> Demo payment</span>{experience.showPaymentMethods && <PaymentMarks />}</div><div className="co-card-preview"><div><LockKeyhole size={16} /><span>Card details are not collected</span></div><div className="co-card-placeholder" aria-hidden="true"><span>••••  ••••  ••••  ••••</span><span>MM / YY</span><span>CVC</span></div><p>This is a design preview. Place a test order below without a card or a charge.</p></div></div>;
}

function TrustRow({ brand }: { brand: Brand }) {
  if (!checkoutExperience(brand).showTrustBadges) return null;
  return <div className="co-trust-row"><span><CheckCircle2 size={17} /> Clear totals</span><span><LockKeyhole size={17} /> No card charged</span><span><Truck size={17} /> Test shipping shown</span></div>;
}

function ReviewCard({ brand }: { brand: Brand }) {
  const experience = checkoutExperience(brand);
  if (!experience.showReview || !experience.reviewQuote) return null;
  const rating = Math.max(1, Math.min(5, experience.reviewRating));
  return <figure className="co-review"><div className="co-stars" aria-label={`${rating} out of 5 stars`}>{Array.from({ length: 5 }, (_, i) => <Star key={i} size={15} fill={i < rating ? "currentColor" : "none"} />)}</div><blockquote>“{experience.reviewQuote}”</blockquote><figcaption><span className="co-review-avatar">{experience.reviewAuthor.slice(0, 1) || "C"}</span><div><strong>{experience.reviewAuthor || "Customer"}</strong><span>{experience.reviewConfirmed ? "Review supplied by the merchant" : "Sample review · design preview"}</span></div></figcaption></figure>;
}

function Faq({ brand, preview = false }: { brand: Brand; preview?: boolean }) {
  const experience = checkoutExperience(brand);
  if (!experience.showFaq) return null;
  const entries = [
    ["Will I be charged?", "No. This demo creates a test order only. No payment is collected and no products will be shipped."],
    ["What should I know about delivery?", experience.deliveryText || "Test shipping is calculated in your order summary. No products will be shipped in demo mode."],
    ...(experience.returnsText ? [["What is the returns policy?", experience.returnsText]] : []),
  ];
  return <div className="co-faq"><h3>A few helpful details</h3>{entries.map(([question, answer]) => preview ? <div className="co-preview-faq" key={question}><strong>{question}</strong><p>{answer}</p></div> : <details key={question}><summary>{question}<ChevronDown size={16} /></summary><p>{answer}</p></details>)}</div>;
}

function Offer({ brand }: { brand: Brand }) {
  const { offerEndsAt, offerText } = checkoutExperience(brand);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!offerEndsAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [offerEndsAt]);
  const end = Date.parse(offerEndsAt);
  if (!offerText || (offerEndsAt && (!Number.isFinite(end) || now === null || end <= now))) return null;
  const seconds = now === null ? 0 : Math.max(0, Math.ceil((end - now) / 1000));
  return <div className="co-offer"><Clock3 size={17} /><div><strong>{offerText}</strong>{offerEndsAt && <span>Ends in {Math.floor(seconds / 3600)}h {Math.floor(seconds % 3600 / 60)}m {seconds % 60}s</span>}</div></div>;
}

function Totals({ totals }: { totals: OrderBreakdown }) {
  return <div className="co-totals"><div><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>{totals.discount > 0 && <div className="co-discount-line"><span>Discount</span><span>−{money(totals.discount)}</span></div>}<div><span>Test shipping</span><span>{totals.shipping === 0 ? "Free" : money(totals.shipping)}</span></div>{totals.priority > 0 && <div><span>Priority processing</span><span>{money(totals.priority)}</span></div>}{totals.tip > 0 && <div><span>Tip</span><span>{money(totals.tip)}</span></div>}<div className="co-tax-line"><span>Taxes</span><span>Not calculated in demo</span></div><div className="co-total"><strong>Test order total</strong><span><small>USD</small><strong>{money(totals.total)}</strong></span></div></div>;
}

function ShippingProgress({ brand, totals }: { brand: Brand; totals: OrderBreakdown }) {
  if (brand.freeShippingThreshold <= 0 || brand.shippingPrice <= 0) return null;
  const merchandise = totals.subtotal - totals.discount;
  const remaining = Math.max(0, brand.freeShippingThreshold - merchandise);
  return <div className="co-shipping-progress"><p>{remaining > 0 ? <><Truck size={16} /> {money(remaining)} away from free test shipping</> : <><Check size={16} /> Your order qualifies for free test shipping</>}</p><div className="co-progress-track"><span style={{ width: `${Math.min(100, merchandise / brand.freeShippingThreshold * 100)}%` }} /></div></div>;
}

export function CheckoutPreview({ brand }: { brand: Brand }) {
  const product = brand.products.find((item) => item.available);
  const experience = checkoutExperience(brand);
  const totals = checkoutTotals(brand, product ? [{ price: product.price, quantity: 1 }] : []);
  const bump = brand.products.find((item) => item.available && item.id === experience.bumpProductId && item.id !== product?.id);
  return <div className="checkout-preview" style={brandStyle(brand)}>
    <div className="co-preview-label">CHECKOUT DESIGN PREVIEW <span>No payments collected</span></div>
    {brand.announcement && <div className="co-announcement">{brand.announcement}</div>}
    <div className="co-preview-body"><section className="co-preview-details"><BrandHeader brand={brand} /><div className="co-breadcrumb">Information <span>›</span> Delivery <span>›</span> Payment</div><h2>{brand.checkoutTitle || "A little closer to yours."}</h2>{experience.showPaymentMethods && <ExpressPayment preview />}<div className="co-preview-form"><h3>Contact</h3><div className="co-preview-input">Email address</div><h3>Delivery</h3><div className="co-field-row"><div className="co-preview-input">First name</div><div className="co-preview-input">Last name</div></div><div className="co-preview-input">Street address</div><div className="co-field-row"><div className="co-preview-input">City</div><div className="co-preview-input">Postal code</div></div><div className="co-preview-input">United States <ChevronDown size={14} /></div><h3>Shipping method</h3><div className="co-delivery"><Truck size={18} /><div><strong>Standard test shipping</strong><span>{experience.deliveryText}</span></div><strong>{totals.shipping === 0 ? "Free" : money(totals.shipping)}</strong></div>{experience.priorityEnabled && <div className="co-preview-option">□ {experience.priorityLabel}<strong>+{money(experience.priorityPrice)}</strong></div>}<h3>Payment</h3><PaymentPanel brand={brand} />{experience.allowTips && <div className="co-preview-tips"><strong>Add a tip (optional)</strong><div><span className="co-selected">None</span><span>5%</span><span>10%</span><span>15%</span></div></div>}<div className="co-preview-submit">Place test order · {money(totals.total)}<ArrowRight size={16} /></div><p className="co-submit-note">No card needed. No payment collected.</p><TrustRow brand={brand} /></div></section><aside className="co-preview-summary"><h3>Order summary</h3>{product ? <><ProductLine product={product} quantity={1} /><ShippingProgress brand={brand} totals={totals} />{experience.discountCode && experience.discountPercent > 0 && <div className="co-preview-promo"><div className="co-preview-input">Discount code</div><span>Apply</span></div>}{bump && <div className="co-preview-bump"><span>COMPLETE YOUR ORDER</span><ProductLine product={bump} quantity={1} /><p>□ Add {bump.title} · {money(bump.price)}</p></div>}<Totals totals={totals} /></> : <p className="co-muted">Add an available product to preview your order.</p>}<Offer brand={brand} /><ReviewCard brand={brand} /><Faq brand={brand} preview />{experience.returnsText && !experience.showFaq && <p className="co-merchant-note">{experience.returnsText}</p>}</aside></div>
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
  const experience = checkoutExperience(brand);
  const [productId, setProductId] = useState(products[0]?.id || "");
  const [quantity, setQuantity] = useState(1);
  const [bumpSelected, setBumpSelected] = useState(false);
  const [priority, setPriority] = useState(false);
  const [tipPercent, setTipPercent] = useState<0 | 5 | 10 | 15>(0);
  const [discountInput, setDiscountInput] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [discountError, setDiscountError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ orderId: string; total: number } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [offerNow, setOfferNow] = useState<number | null>(null);
  const submission = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const syncSummary = () => setSummaryOpen(desktop.matches);
    syncSummary();
    desktop.addEventListener("change", syncSummary);
    return () => desktop.removeEventListener("change", syncSummary);
  }, []);
  useEffect(() => {
    if (!experience.offerEndsAt || !discountCode) return;
    const update = () => setOfferNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [experience.offerEndsAt, discountCode]);
  const calculationTime = Math.max(offerNow ?? 0, Date.now());
  const discountExpired = Boolean(discountCode && experience.offerEndsAt && Date.parse(experience.offerEndsAt) <= calculationTime);
  useEffect(() => {
    if (!discountExpired) return;
    setDiscountCode("");
    setDiscountError("This discount offer has expired. Your total has been updated.");
  }, [discountExpired]);
  const product = products.find((item) => item.id === productId);
  const bump = products.find((item) => item.id === experience.bumpProductId && item.id !== productId);
  const items = product ? [{ productId: product.id, price: product.price, quantity }, ...(bump && bumpSelected ? [{ productId: bump.id, price: bump.price, quantity: 1 }] : [])] : [];
  const options: CheckoutOptions = { discountCode: discountExpired ? "" : discountCode, tipPercent, priority };
  const totals = checkoutTotals(brand, items, options, calculationTime);
  const demo = brand.mode === "demo";
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  function applyDiscount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const code = discountInput.trim();
      if (!code) throw new Error("Enter a discount code first.");
      checkoutTotals(brand, items, { ...options, discountCode: code });
      setDiscountCode(code.toUpperCase());
      setDiscountError("");
    } catch (cause) { setDiscountError(cause instanceof Error ? cause.message : "This discount could not be applied."); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || submitting || !demo) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      checkoutTotals(brand, items, options);
      const customer = Object.fromEntries(["email", "firstName", "lastName", "address", "city", "postalCode", "country"].map((key) => [key, String(form.get(key) || "").trim()]));
      const body = JSON.stringify({ items: items.map(({ productId, quantity }) => ({ productId, quantity })), customer, mode: "demo", options });
      if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() };
      const response = await fetch(`/api/checkout/${encodeURIComponent(brand.slug)}`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": submission.current.key }, body,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your order couldn't be created. Please try again.");
      if (result.mode !== "demo" || typeof result.orderId !== "string" || !result.orderId || typeof result.total !== "number" || !Number.isFinite(result.total)) throw new Error("We couldn't verify the checkout response. Please contact the brand before retrying.");
      setConfirmation({ orderId: result.orderId, total: result.total });
      submission.current = null;
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
    } finally { setSubmitting(false); }
  }

  return <main className="checkout-page" style={brandStyle(brand)}>
    <div className="co-demo-banner"><span>DEMO CHECKOUT</span> No real payment. No products will be shipped.</div>
    {brand.announcement && <div className="co-announcement">{brand.announcement}</div>}
    <header className="co-header"><BrandHeader brand={brand} /><span className="co-header-label"><ShoppingBag size={17} /> Test checkout</span></header>
    {confirmation ? <section className="co-confirmation" aria-live="polite" aria-atomic="true"><div className="co-success-icon"><CheckCircle2 size={34} /></div><div className="co-eyebrow">TEST ORDER CONFIRMED</div><h1>You’re all set.</h1><p>Your test order for {brand.name} was created.<br />No payment was collected. No products will be shipped.</p><dl><div><dt>Order number</dt><dd>{confirmation.orderId}</dd></div><div><dt>Test order total</dt><dd>{money(confirmation.total)}</dd></div></dl><button className="co-button" onClick={() => setConfirmation(null)}><ArrowLeft size={16} /> Back to checkout</button><p className="co-powered">Powered by <strong>limitless checkout</strong></p></section> : <div className="co-layout">
      <section className="co-details"><nav aria-label="Checkout steps" className="co-breadcrumb"><span aria-current="step">Information</span><span>›</span> Delivery <span>›</span> Payment</nav><h1>{brand.checkoutTitle || "A little closer to yours."}</h1><p className="co-intro">The details you need. Nothing you don’t.</p>
        {experience.showPaymentMethods && <ExpressPayment />}
        <form onSubmit={submit} className="co-form"><fieldset disabled={submitting || !product || !demo}><legend>Contact</legend><label className="co-field">Email address<input type="email" name="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></label><p className="co-field-note">Use fictional details for this test order.</p></fieldset>
          <fieldset disabled={submitting || !product || !demo}><legend>Delivery</legend><label className="co-field">Country / region<select name="country" autoComplete="country" required defaultValue="US">{LAUNCH_COUNTRY_CODES.map(code => <option key={code} value={code}>{COUNTRY_NAMES[code]}</option>)}</select></label><div className="co-field-row"><label className="co-field">First name<input name="firstName" autoComplete="given-name" placeholder="First name" required maxLength={80} /></label><label className="co-field">Last name<input name="lastName" autoComplete="family-name" placeholder="Last name" required maxLength={80} /></label></div><label className="co-field">Street address<input name="address" autoComplete="street-address" placeholder="Street address, apartment, suite" required maxLength={200} /></label><div className="co-field-row"><label className="co-field">City<input name="city" autoComplete="address-level2" placeholder="City" required maxLength={100} /></label><label className="co-field">Postal code<input name="postalCode" autoComplete="postal-code" placeholder="Postal code" required maxLength={20} /></label></div></fieldset>
          <fieldset disabled={submitting || !product || !demo}><legend>Shipping method</legend><div className="co-delivery"><span className="co-radio-dot" /><div><strong>Standard test shipping</strong><span>{experience.deliveryText}</span><span>Simulated delivery · no items will ship</span></div><strong>{totals.shipping === 0 ? "Free" : money(totals.shipping)}</strong></div>{experience.priorityEnabled && <label className="co-option"><input type="checkbox" checked={priority} onChange={(event) => setPriority(event.target.checked)} /><span><strong>{experience.priorityLabel}</strong><small>Optional · test order only</small></span><strong>+{money(experience.priorityPrice)}</strong></label>}</fieldset>
          <fieldset disabled={submitting || !product || !demo}><legend>Payment</legend><PaymentPanel brand={brand} />{experience.allowTips && <div className="co-tips"><span id="co-tip-label">Add a tip <small>(optional)</small></span><div className="co-tip-options" role="group" aria-labelledby="co-tip-label">{([0, 5, 10, 15] as const).map((tip) => <button key={tip} type="button" aria-pressed={tipPercent === tip} onClick={() => setTipPercent(tip)}>{tip === 0 ? "None" : `${tip}%`}</button>)}</div><p>Based on your discounted merchandise subtotal.</p></div>}</fieldset>
          {!demo && <p className="co-error" role="alert">Live checkout is not available. This page is a design preview only.</p>}
          {error && <div className="co-error" role="alert">{error}</div>}
          <button className="co-button" type="submit" disabled={submitting || !product || !demo}>{submitting ? "Creating your test order…" : `Place test order · ${money(totals.total)}`}<ArrowRight size={18} /></button><p className="co-submit-note"><LockKeyhole size={13} /> No card needed. No payment collected.</p><TrustRow brand={brand} />
        </form><div className="co-mobile-reassurance"><ReviewCard brand={brand} /><Faq brand={brand} />{experience.returnsText && !experience.showFaq && <p className="co-merchant-note">{experience.returnsText}</p>}</div><footer className="co-footer">{brand.supportEmail && <a href={`mailto:${brand.supportEmail}`}>Need a hand? Contact us</a>}<span className="co-powered">Powered by <strong>limitless checkout</strong></span></footer>
      </section>
      <aside className="co-summary" aria-label="Order summary"><div className="co-summary-sticky"><details className="co-summary-disclosure" open={summaryOpen} onToggle={(event) => setSummaryOpen(event.currentTarget.open)}><summary><span><ShoppingBag size={18} /> Order summary <ChevronDown size={16} /></span><strong>{money(totals.total)}</strong></summary><div className="co-summary-content"><div className="co-summary-heading"><h2>Your order</h2><span>{itemCount} {itemCount === 1 ? "item" : "items"}</span></div>
        {product ? <><ProductLine product={product} quantity={quantity} />{bump && bumpSelected && <ProductLine product={bump} quantity={1} />}{products.length > 1 && <label className="co-field co-product-select">Choose your product<select value={productId} onChange={(event) => { setProductId(event.target.value); setBumpSelected(false); }} disabled={submitting}>{products.map((item) => <option key={item.id} value={item.id}>{item.title} — {money(item.price)}</option>)}</select></label>}<div className="co-quantity-row"><span>Quantity</span><div className="co-quantity"><button type="button" aria-label="Decrease quantity" disabled={quantity <= 1 || submitting} onClick={() => setQuantity((value) => value - 1)}><Minus size={14} /></button><output aria-live="polite" aria-label="Quantity">{quantity}</output><button type="button" aria-label="Increase quantity" disabled={quantity >= 10 || submitting} onClick={() => setQuantity((value) => value + 1)}><Plus size={14} /></button></div></div><ShippingProgress brand={brand} totals={totals} />
          {experience.discountCode && experience.discountPercent > 0 && <form className="co-promo" onSubmit={applyDiscount}><label className="co-field">Discount code<input value={discountInput} onChange={(event) => setDiscountInput(event.target.value)} placeholder="Enter code" disabled={submitting} aria-invalid={!!discountError} aria-describedby={discountError ? "co-discount-error" : undefined} /></label><button type="submit" disabled={submitting}>Apply</button>{discountError && <p id="co-discount-error" className="co-discount-error" role="alert">{discountError}</p>}{discountCode && <div className="co-applied" role="status"><span><Check size={14} /> {discountCode} applied</span><button type="button" disabled={submitting} onClick={() => { setDiscountCode(""); setDiscountInput(""); setDiscountError(""); }} aria-label={`Remove discount ${discountCode}`}>Remove</button></div>}</form>}
          {bump && <label className={`co-bump ${bumpSelected ? "co-bump-selected" : ""}`}><span className="co-bump-eyebrow">A LITTLE SOMETHING EXTRA</span><span className="co-bump-body"><input type="checkbox" checked={bumpSelected} disabled={submitting} onChange={(event) => setBumpSelected(event.target.checked)} /><span className="co-bump-image"><ProductImage image={bump.image} title={bump.title} /></span><span><strong>Add {bump.title}</strong><small>Optional addition to your test order</small></span><strong>+{money(bump.price)}</strong></span></label>}
          <div aria-live="polite" aria-atomic="true"><Totals totals={totals} /></div><p className="co-summary-note">All costs shown above. This is not a paid order.</p>
        </> : <div className="co-empty"><ShoppingBag size={32} /><h3>No products available</h3><p>This brand is still setting up its collection. Please check back soon.</p></div>}</div></details><Offer brand={brand} /><ReviewCard brand={brand} /><Faq brand={brand} />{experience.returnsText && !experience.showFaq && <p className="co-merchant-note">{experience.returnsText}</p>}</div></aside>
    </div>}
  </main>;
}
