"use client";

import type { Brand, CheckoutExperience } from "@/lib/types";

function localDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function CheckoutSettings({ brand, value, onChange }: { brand: Brand; value: CheckoutExperience; onChange: (value: CheckoutExperience) => void }) {
  const update = <K extends keyof CheckoutExperience>(key: K, next: CheckoutExperience[K]) => onChange({ ...value, [key]: next });
  return <div className="checkout-settings">
    <details open className="conversion-section">
      <summary>Trust & payment presentation <span>01</span></summary>
      <div className="conversion-fields">
        <label className="setting-toggle"><input type="checkbox" checked={value.showPaymentMethods} onChange={e => update("showPaymentMethods", e.target.checked)} /><span>Payment-method examples<small>Clearly labeled preview, not active payment methods.</small></span></label>
        <label className="setting-toggle"><input type="checkbox" checked={value.showTrustBadges} onChange={e => update("showTrustBadges", e.target.checked)} /><span>Checkout reassurance<small>Transparent totals and no-card-required demo messaging.</small></span></label>
        <label className="field">Delivery information<textarea rows={3} maxLength={500} value={value.deliveryText} onChange={e => update("deliveryText", e.target.value)} /></label>
        <label className="field">Returns policy summary<textarea rows={3} maxLength={500} value={value.returnsText} onChange={e => update("returnsText", e.target.value)} placeholder="Your actual policy. Leave empty to hide." /></label>
        <label className="setting-toggle"><input type="checkbox" checked={value.showFaq} onChange={e => update("showFaq", e.target.checked)} /><span>Show checkout FAQ<small>Uses this brand’s delivery and returns information.</small></span></label>
      </div>
    </details>
    <details className="conversion-section">
      <summary>Customer review <span>02</span></summary>
      <div className="conversion-fields">
        <label className="setting-toggle"><input type="checkbox" checked={value.showReview} onChange={e => update("showReview", e.target.checked)} /><span>Show review card</span></label>
        {value.showReview && <>
          <label className="field">Customer quote<textarea rows={4} maxLength={500} value={value.reviewQuote} onChange={e => { onChange({ ...value, reviewQuote: e.target.value, reviewConfirmed: false }); }} /></label>
          <label className="field">Reviewer name<input maxLength={80} value={value.reviewAuthor} onChange={e => { onChange({ ...value, reviewAuthor: e.target.value, reviewConfirmed: false }); }} /></label>
          <label className="field">Rating<select value={value.reviewRating} onChange={e => onChange({ ...value, reviewRating: Number(e.target.value), reviewConfirmed: false })}>{[5, 4, 3, 2, 1].map(rating => <option key={rating} value={rating}>{rating} {rating === 1 ? "star" : "stars"}</option>)}</select></label>
          <label className="setting-toggle"><input type="checkbox" checked={value.reviewConfirmed} onChange={e => update("reviewConfirmed", e.target.checked)} /><span>This is genuine feedback<small>I have permission to display it and the quote and rating are accurate. This does not mark the buyer as verified.</small></span></label>
          {!value.reviewConfirmed && <p className="field-hint">The checkout labels this “Sample review · design preview.” It will not be shown as real customer feedback.</p>}
        </>}
      </div>
    </details>
    <details className="conversion-section">
      <summary>Offers & order value <span>03</span></summary>
      <div className="conversion-fields">
        <p className="field-hint">Optional extras start off. All selections and discounts are included in the server-calculated test order.</p>
        <div className="field-row"><label className="field">Discount code<input maxLength={30} pattern="[A-Za-z0-9_-]*" value={value.discountCode} onChange={e => update("discountCode", e.target.value.toUpperCase())} placeholder="WELCOME10" /></label><label className="field">Percent off<input type="number" min={0} max={90} step={1} value={value.discountPercent} onChange={e => update("discountPercent", Number(e.target.value))} /></label></div>
        <p className="field-hint">Clear the code and set 0% to disable. Free shipping eligibility is based on the discounted product subtotal.</p>
        <label className="field">Order-bump product<select value={value.bumpProductId} onChange={e => update("bumpProductId", e.target.value)}><option value="">No order bump</option>{brand.products.filter(product => product.available).map(product => <option key={product.id} value={product.id}>{product.title} · ${product.price.toFixed(2)}</option>)}</select></label>
        <p className="field-hint">Shown only when different from the main product. Never preselected.</p>
        <label className="setting-toggle"><input type="checkbox" checked={value.priorityEnabled} onChange={e => update("priorityEnabled", e.target.checked)} /><span>Optional priority processing<small>Only offer this if your brand can fulfill it.</small></span></label>
        {value.priorityEnabled && <><label className="field">Processing option label<input required maxLength={80} value={value.priorityLabel} onChange={e => update("priorityLabel", e.target.value)} /></label><label className="field">Additional price · USD<input required type="number" min={0} max={100000} step="0.01" value={value.priorityPrice} onChange={e => update("priorityPrice", Number(e.target.value))} /></label></>}
        <label className="setting-toggle"><input type="checkbox" checked={value.allowTips} onChange={e => update("allowTips", e.target.checked)} /><span>Optional tips<small>Default is no tip. Based on discounted products, excluding shipping.</small></span></label>
      </div>
    </details>
    <details className="conversion-section">
      <summary>Time-limited offer <span>04</span></summary>
      <div className="conversion-fields">
        <p className="field-hint">For a genuine discount deadline only. Configure a discount code above first. The fixed timer never resets, disappears at expiry, and the code stops working. Base prices stay unchanged.</p>
        <label className="field">Offer text<input maxLength={160} value={value.offerText} onChange={e => update("offerText", e.target.value)} placeholder="Your actual limited-time offer" /></label>
        <label className="field">Ends at · your local time<input type="datetime-local" value={localDateTime(value.offerEndsAt)} onChange={e => update("offerEndsAt", e.target.value ? new Date(e.target.value).toISOString() : "")} /></label>
        <p className="field-hint">Leave both fields empty to hide the timer.</p>
      </div>
    </details>
  </div>;
}
