"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, CheckCircle2, Clock3, ShoppingBag, TriangleAlert } from "lucide-react";
import type { Brand } from "@/lib/types";
import { CHECKOUT_CURRENCY } from "@/lib/markets";

type PaymentStatus = {
  status: "awaiting_payment" | "processing" | "confirmed" | "review" | "expired";
  totalCents: number;
  currency: "USD";
  expiresAt: number;
};

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: CHECKOUT_CURRENCY }).format(cents / 100);

function brandStyle(brand: Brand) {
  const accent = /^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent : "#344b40";
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(accent.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return { "--co-accent": accent, "--co-accent-ink": luminance > 0.179 ? "#111111" : "#ffffff" } as CSSProperties;
}

export function PaymentReturnPage({ brand, receipt }: { brand: Brand; receipt: string }) {
  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState("");
  const returnUrl = brand.domain ? `https://${brand.domain}` : "/";

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    async function check() {
      try {
        const response = await fetch(`/api/checkout/${encodeURIComponent(brand.slug)}/status?receipt=${encodeURIComponent(receipt)}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "We couldn't verify this payment yet.");
        if (stopped) return;
        setStatus(result as PaymentStatus);
        setError("");
        attempts++;
        if (["awaiting_payment", "processing"].includes(result.status) && attempts < 60) timer = setTimeout(check, 2000);
      } catch (cause) {
        if (stopped) return;
        setError(cause instanceof Error ? cause.message : "We couldn't verify this payment yet.");
      }
    }
    void check();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [brand.slug, receipt]);

  return <main className="checkout-page" style={brandStyle(brand)}>
    <header className="co-header"><div className="co-brand"><span className="co-brand-mark">{brand.logoInitial}</span><span>{brand.name}</span></div><span className="co-header-label"><ShoppingBag size={17} /> Payment status</span></header>
    <section className="co-confirmation" aria-live="polite" aria-atomic="true">
      {!status && !error && <><div className="co-success-icon"><Clock3 size={34} /></div><div className="co-eyebrow">CHECKING PAYMENT</div><h1>Confirming your order…</h1><p>Keep this page open while we verify the payment and Shopify order.</p></>}
      {error && <><div className="co-success-icon"><TriangleAlert size={34} /></div><div className="co-eyebrow">STATUS UNAVAILABLE</div><h1>We couldn't confirm the payment yet.</h1><p>{error}</p><p>If you completed payment, do not pay again. Return here later or contact the store if the status does not update.</p></>}
      {status?.status === "confirmed" && <><div className="co-success-icon"><CheckCircle2 size={34} /></div><div className="co-eyebrow">PAYMENT CONFIRMED</div><h1>Your order is confirmed.</h1><p>Your payment was verified and the Shopify order was completed successfully.</p><dl><div><dt>Total</dt><dd>{money(status.totalCents)}</dd></div></dl></>}
      {status?.status === "processing" && <><div className="co-success-icon"><Clock3 size={34} /></div><div className="co-eyebrow">PAYMENT RECEIVED</div><h1>We're finishing your order.</h1><p>Your payment has been verified. Shopify synchronization is still processing. Do not pay again.</p><dl><div><dt>Total</dt><dd>{money(status.totalCents)}</dd></div></dl></>}
      {status?.status === "awaiting_payment" && <><div className="co-success-icon"><Clock3 size={34} /></div><div className="co-eyebrow">WAITING FOR CONFIRMATION</div><h1>We're checking the payment.</h1><p>If you just completed payment, keep this page open while the signed provider confirmation arrives.</p><dl><div><dt>Total</dt><dd>{money(status.totalCents)}</dd></div></dl></>}
      {status?.status === "review" && <><div className="co-success-icon"><TriangleAlert size={34} /></div><div className="co-eyebrow">PAYMENT NEEDS REVIEW</div><h1>Do not pay again.</h1><p>A payment was recorded, but the order needs merchant review before we can confirm fulfillment.</p><dl><div><dt>Total</dt><dd>{money(status.totalCents)}</dd></div></dl></>}
      {status?.status === "expired" && <><div className="co-success-icon"><TriangleAlert size={34} /></div><div className="co-eyebrow">CHECKOUT EXPIRED</div><h1>This payment attempt expired.</h1><p>No successful payment has been confirmed for this attempt. Return to the store and begin a fresh checkout.</p></>}
      <a className="co-button" href={returnUrl}><ArrowLeft size={16} /> Return to {brand.name}</a>
    </section>
  </main>;
}
