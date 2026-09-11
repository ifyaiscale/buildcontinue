"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity as ActivityIcon,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  ExternalLink,
  Globe,
  Infinity as InfinityIcon,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Package,
  Palette,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
  X,
  Zap,
} from "lucide-react";
import type { AppState, Brand, Order } from "@/lib/types";
import { CheckoutPreview } from "@/components/checkout";
import { CheckoutSettings } from "@/components/checkout-settings";
import { checkoutExperience } from "@/lib/checkout";
import { accountDetails } from "@/lib/accounts";
import { dashboardFetch, isEmbeddedWorkspace } from "@/lib/client-api";
import {
  AccountDetailsForm,
  AccountDetailsSummary,
} from "@/components/account-details";
import "@/app/checkout.css";

type View =
  "overview" | "brands" | "orders" | "studio" | "connections" | "settings";
type Modal = "brand" | "help" | "shopify" | "whop" | "accounts" | null;
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
const shortDate = (date: string) =>
  new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
const navItems = [
  { id: "overview" as View, label: "Overview", icon: LayoutDashboard },
  { id: "brands" as View, label: "Your brands", icon: Store },
  { id: "orders" as View, label: "Orders", icon: ShoppingBag },
  { id: "studio" as View, label: "Checkout studio", icon: Palette },
  { id: "connections" as View, label: "Connections", icon: Link2 },
];

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await dashboardFetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Something went wrong. Please try again.");
  return result as T;
}

function ProviderLogo({
  provider,
  size = "",
}: {
  provider: "shopify" | "whop";
  size?: string;
}) {
  return (
    <span
      className={`provider-logo ${provider} ${size}`}
      aria-label={provider === "shopify" ? "Shopify" : "Whop"}
    >
      {provider === "shopify" ? (
        <ShoppingBag size={17} strokeWidth={2.5} />
      ) : (
        <span className="whop-mark">w</span>
      )}
    </span>
  );
}

function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber";
}) {
  return (
    <span className={`status status-${tone}`}>
      <span />
      {children}
    </span>
  );
}

function ModalFrame({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Dashboard() {
  const [data, setData] = useState<AppState | null>(null);
  const [view, setView] = useState<View>("overview");
  const [selectedId, setSelectedId] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(30);
  const [notifications, setNotifications] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [busy, setBusy] = useState(false);
  const [orderDetail, setOrderDetail] = useState<Order | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (response.status === 401) {
        setAuthRequired(true);
        return;
      }
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not load workspace.");
      setData(result);
      setError("");
      setAuthRequired(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const selected =
    data?.brands.find((b) => b.id === selectedId) ?? data?.brands[0];
  const filteredBrands =
    data?.brands.filter((b) =>
      `${b.name} ${b.category} ${b.domain}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  const filteredOrders = useMemo(
    () =>
      (data?.orders ?? []).filter(
        (order) =>
          new Date(order.createdAt).getTime() >= Date.now() - days * 86400000,
      ),
    [data?.orders, days],
  );
  const paid = filteredOrders.filter((o) => o.status === "paid");
  const revenue = paid.reduce((sum, order) => sum + order.total, 0);
  const navigate = (next: View, brand?: Brand) => {
    setView(next);
    if (brand) setSelectedId(brand.id);
    setSearch("");
    setMobileNav(false);
    setNotifications(false);
  };
  const changed = async (message: string) => {
    await refresh();
    setToast(message);
  };
  const publish = async (brand: Brand, mode: "demo" | "live") => {
    setBusy(true);
    try {
      await api(`/api/brands/${brand.id}/publish`, "POST", { mode });
      await changed(
        mode === "demo"
          ? "Test checkout published. No real payments will be collected."
          : "Checkout published.",
      );
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Could not publish.");
    } finally {
      setBusy(false);
    }
  };

  if (authRequired) return <Login onSuccess={refresh} />;
  if (loading || !data)
    return (
      <div className="loading-screen">
        <div className="brand-symbol">
          <InfinityIcon size={28} />
        </div>
        <h1>Limitless Checkout</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="button primary" onClick={refresh}>
              Try again
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={24} />
            <p>Opening your workspace…</p>
          </>
        )}
      </div>
    );

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <button
          className="wordmark"
          onClick={() => navigate("overview")}
          aria-label="Limitless Checkout home"
        >
          <span className="brand-symbol">
            <InfinityIcon size={25} strokeWidth={2.5} />
          </span>
          <span>
            limitless<span className="wordmark-sub">CHECKOUT</span>
          </span>
        </button>
        <div className="workspace-card">
          <span className="workspace-avatar">
            L<span />
          </span>
          <div>
            <strong>My workspace</strong>
            <span>Multi-brand workspace</span>
          </div>
          <span className="workspace-count">{data.brands.length}</span>
        </div>
        <span className="nav-eyebrow">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.id === "brands" && (
                <span className="nav-count">{data.brands.length}</span>
              )}
              {item.id === "studio" && <span className="new-tag">NEW</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="launch-note">
            <span className="launch-icon">
              <Zap size={18} fill="currentColor" />
            </span>
            <strong>Built for your next chapter.</strong>
            <p>
              One beautiful checkout.
              <br />
              Every brand you build.
            </p>
            <button onClick={() => setModal("brand")}>
              Add your next brand <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className={`nav-item ${view === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={19} />
            <span>Workspace settings</span>
          </button>
          <button className="nav-item" onClick={() => setModal("help")}>
            <CircleHelp size={19} />
            <span>Help & getting started</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-account">
            <span className="account-avatar">LC</span>
            <div>
              <strong>Brand owner</strong>
              <span>
                {data.environment.demo ? "Demo workspace" : "Private workspace"}
              </span>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-workspace">Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {view === "settings"
                ? "Settings"
                : navItems.find((n) => n.id === view)?.label}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="workspace-private">
              <LockKeyhole size={12} />
              {data.environment.demo ? "Demo environment" : "Private workspace"}
            </span>
            <div className="notification-wrap">
              <button
                className={`icon-button notification-button ${notifications ? "selected" : ""}`}
                aria-label="Recent activity"
                aria-expanded={notifications}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={18} />
                {data.activity.length > 0 && <i />}
              </button>
              {notifications && (
                <div className="notification-panel">
                  <h3>Workspace activity</h3>
                  <ActivityList data={data} />
                  {!data.activity.length && <p>No activity yet.</p>}
                </div>
              )}
            </div>
            <span className="topbar-divider" />
            <span className="account-avatar small">LC</span>
          </div>
        </header>
        <main className="main-content">
          {!data.environment.liveEnabled && (
            <div className="demo-strip">
              <span>
                <span className="demo-dot" />
                <strong>Your playground, without the risk.</strong> Sample
                brands and test orders. No real payments.
              </span>
              <button onClick={() => navigate("settings")}>
                Set up live access <ArrowRight size={14} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="page-eyebrow">
                {view === "overview"
                  ? "THE BIG PICTURE"
                  : view === "studio"
                    ? "MAKE IT YOURS"
                    : view === "connections"
                      ? "BETTER TOGETHER"
                      : "YOUR WORKSPACE"}
              </div>
              <h1>
                {view === "overview"
                  ? "Your brands are growing."
                  : view === "brands"
                    ? "Your brands, all together."
                    : view === "orders"
                      ? "Every order. One place."
                      : view === "studio"
                        ? "A checkout that feels like you."
                        : view === "connections"
                          ? "Connect the dots."
                          : "A strong foundation."}
              </h1>
              <p>
                {view === "overview"
                  ? "A clear view of every brand. More room for what’s next."
                  : view === "brands"
                    ? "Different identities. One beautifully connected workspace."
                    : view === "orders"
                      ? "Track purchases and their journey back to Shopify."
                      : view === "studio"
                        ? "Turn your brand’s first impression into a lasting one."
                        : view === "connections"
                          ? "Your storefront on Shopify. Your payments through Whop."
                          : "Keep your workspace secure and get ready for real customers."}
              </p>
            </div>
            <div className="heading-actions">
              {view === "overview" && (
                <div className="date-filter">
                  <ActivityIcon size={15} />
                  <select
                    aria-label="Reporting period"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    <option value={7}>Last 7 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                  </select>
                  <ChevronDown size={13} />
                </div>
              )}
              {["overview", "brands"].includes(view) && (
                <button
                  className="button primary"
                  onClick={() => setModal("brand")}
                >
                  <Plus size={17} />
                  Add brand
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
              <button onClick={refresh}>Retry</button>
            </div>
          )}
          {view === "overview" && (
            <>
              <div className="stats-grid">
                <Stat
                  title="Total revenue"
                  value={money(revenue)}
                  detail={`${paid.length} completed ${!data.environment.liveEnabled ? "test " : ""}orders`}
                  icon={<ArrowDownLeft size={18} />}
                />
                <Stat
                  title="Total orders"
                  value={String(filteredOrders.length)}
                  detail={`Across ${data.brands.length} brands`}
                  icon={<ShoppingBag size={17} />}
                />
                <Stat
                  title="Average order value"
                  value={money(paid.length ? revenue / paid.length : 0)}
                  detail="Revenue ÷ completed orders"
                  icon={<CreditCard size={17} />}
                />
                <Stat
                  title="Live checkouts"
                  value={String(
                    data.brands.filter(
                      (b) => b.status === "live" && b.mode === "live",
                    ).length,
                  ).padStart(2, "0")}
                  detail={`${data.brands.filter((b) => b.mode === "demo").length} brands in test mode`}
                  icon={<Globe size={17} />}
                />
              </div>
              <div className="overview-middle">
                <section className="panel revenue-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Revenue at a glance{" "}
                        <span className="tiny-label">
                          {!data.environment.liveEnabled ? "TEST DATA" : "USD"}
                        </span>
                      </h2>
                      <p>A little perspective on your momentum.</p>
                    </div>
                    <div className="chart-legend">
                      <span />
                      Revenue
                    </div>
                  </div>
                  <RevenueChart orders={paid} days={days} />
                </section>
                <section className="panel activity-panel">
                  <div className="panel-heading">
                    <h2>Latest activity</h2>
                    <span className="activity-dot" />
                  </div>
                  <ActivityList data={data} />
                  <button
                    className="text-button activity-footer"
                    onClick={() => navigate("orders")}
                  >
                    View all orders <ArrowRight size={14} />
                  </button>
                </section>
              </div>
              <div className="section-heading">
                <div>
                  <h2>
                    Your brands{" "}
                    <span className="section-count">{data.brands.length}</span>
                  </h2>
                  <p>Made to stand out. Managed in one place.</p>
                </div>
                <button
                  className="text-button"
                  onClick={() => navigate("brands")}
                >
                  Manage brands <ArrowRight size={15} />
                </button>
              </div>
              <div className="brands-grid">
                {data.brands.slice(0, 3).map((brand) => (
                  <BrandCard
                    key={brand.id}
                    brand={brand}
                    orders={filteredOrders}
                    onCustomize={() => navigate("studio", brand)}
                    onConnect={() => navigate("connections", brand)}
                  />
                ))}
                {data.brands.length === 0 && (
                  <EmptyState
                    title="A fresh start for your brands"
                    description="Add your first brand to create a branded test checkout."
                    action={
                      <button
                        className="button primary"
                        onClick={() => setModal("brand")}
                      >
                        <Plus size={16} />
                        Add brand
                      </button>
                    }
                  />
                )}
              </div>
              <div className="workspace-footer">
                <span>
                  <ShieldCheck size={14} />
                  Each brand. Its own identity. Its own connections.
                </span>
                <span>
                  Built to go beyond <InfinityIcon size={17} />
                </span>
              </div>
            </>
          )}
          {view === "brands" && (
            <>
              <div className="list-toolbar">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a brand…"
                    aria-label="Search brands"
                  />
                  <kbd>⌕</kbd>
                </label>
                <span className="muted">
                  {filteredBrands.length} brands in your workspace
                </span>
              </div>
              <div className="brands-grid brands-page">
                {filteredBrands.map((brand) => (
                  <BrandCard
                    key={brand.id}
                    brand={brand}
                    orders={data.orders}
                    onCustomize={() => navigate("studio", brand)}
                    onConnect={() => navigate("connections", brand)}
                  />
                ))}
                <button
                  className="add-brand-card"
                  onClick={() => setModal("brand")}
                >
                  <span>
                    <Plus size={23} />
                  </span>
                  <strong>Your next big thing.</strong>
                  <p>Add another brand to your workspace.</p>
                </button>
              </div>
              {!filteredBrands.length && search && (
                <p className="empty-search">No brands match “{search}”.</p>
              )}
            </>
          )}
          {view === "orders" && (
            <OrdersTable data={data} onDetail={setOrderDetail} />
          )}
          {view === "studio" &&
            (selected ? (
              <>
                <BrandSwitcher
                  brands={data.brands}
                  selected={selected}
                  onSelect={setSelectedId}
                />
                <Studio
                  key={selected.id}
                  brand={selected}
                  onSaved={changed}
                  onPublish={() => publish(selected, "demo")}
                  busy={busy}
                />
              </>
            ) : (
              <EmptyState
                title="Start with a brand"
                description="Your checkout studio is ready when you are."
                action={
                  <button
                    className="button primary"
                    onClick={() => setModal("brand")}
                  >
                    Add brand
                  </button>
                }
              />
            ))}
          {view === "connections" &&
            (selected ? (
              <>
                <BrandSwitcher
                  brands={data.brands}
                  selected={selected}
                  onSelect={setSelectedId}
                />
                <div className="connection-flow">
                  <span
                    className="brand-avatar"
                    style={{ background: selected.accent }}
                  >
                    {selected.logoInitial}
                  </span>
                  <div className="flow-line" />
                  <span className="flow-limitless">
                    <InfinityIcon size={27} />
                  </span>
                  <div className="flow-line" />
                  <ProviderLogo provider="whop" size="large" />
                  <div>
                    <strong>One brand. One payment account.</strong>
                    <p>Connections are isolated to {selected.name}.</p>
                  </div>
                </div>
                <AccountDetailsSummary
                  brand={selected}
                  onEdit={() => setModal("accounts")}
                />
                <div className="connections-grid">
                  {(["shopify", "whop"] as const).map((provider) => (
                    <section className="panel connection-card" key={provider}>
                      <div className="connection-card-top">
                        <ProviderLogo provider={provider} size="large" />
                        <Status
                          tone={
                            selected[provider].status === "verified"
                              ? "green"
                              : "neutral"
                          }
                        >
                          {selected[provider].status === "verified"
                            ? "Verified"
                            : "Not connected"}
                        </Status>
                      </div>
                      <h2>{provider === "shopify" ? "Shopify" : "Whop"}</h2>
                      <p>
                        {provider === "shopify"
                          ? "Bring your products and storefront into the picture. Paid orders can return to Shopify for fulfillment."
                          : "Connect the payment account dedicated to this brand. Whop handles payment processing and payouts."}
                      </p>
                      <div className="connection-permissions">
                        {(provider === "shopify"
                          ? [
                              "Verify storefront access",
                              "Import products and variants",
                              "Keep your existing storefront",
                            ]
                          : [
                              "Verify your business account",
                              "Keep credentials encrypted",
                              "Prepare a dedicated connection",
                            ]
                        ).map((text) => (
                          <span key={text}>
                            <Check size={14} />
                            {text}
                          </span>
                        ))}
                      </div>
                      {selected[provider].status === "verified" &&
                        selected[provider].account && (
                          <div className="connected-account">
                            <CheckCheck size={15} />
                            {selected[provider].account}
                          </div>
                        )}
                      <button
                        className="button secondary full-width"
                        onClick={() => setModal(provider)}
                      >
                        {selected[provider].status === "verified"
                          ? "Manage connection"
                          : `Connect ${provider === "shopify" ? "Shopify" : "Whop"}`}
                        <ArrowUpRight size={15} />
                      </button>
                    </section>
                  ))}
                </div>
                <div className="connection-advisory">
                  <ShieldCheck size={21} />
                  <div>
                    <strong>Connected doesn’t mean live—by design.</strong>
                    <p>
                      Verified accounts are only the first step. Live checkout
                      also needs a public deployment, signed webhooks, a
                      permitted Shopify integration, and an end-to-end payment
                      test. Whop’s risk and reserve policies still apply.
                    </p>
                  </div>
                </div>
                <div className="panel launch-panel">
                  <div>
                    <h2>Ready for the real thing?</h2>
                    <p>
                      {data.environment.liveEnabled
                        ? "Review this brand’s connections before enabling real payments."
                        : "Live payments are locked until deployment and integration requirements are complete."}
                    </p>
                  </div>
                  <button
                    className="button primary"
                    disabled={busy || !data.environment.liveEnabled}
                    onClick={() => publish(selected, "live")}
                  >
                    <LockKeyhole size={15} />
                    Enable live checkout
                  </button>
                </div>
              </>
            ) : (
              <EmptyState
                title="Add a brand first"
                description="Every brand gets its own Shopify and Whop connections."
              />
            ))}
          {view === "settings" && (
            <SettingsPanel
              data={data}
              onLogout={async () => {
                try {
                  await api("/api/auth/logout", "POST", {});
                  await refresh();
                } catch (err) {
                  setToast(
                    err instanceof Error ? err.message : "Could not sign out.",
                  );
                }
              }}
              onHelp={() => setModal("help")}
            />
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={16} />
          </span>
          {toast}
          <button
            className="icon-button"
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal === "brand" && (
        <BrandWizard
          onClose={() => setModal(null)}
          onCreated={async (brand) => {
            await changed(`${brand.name} has a new home.`);
            setSelectedId(brand.id);
            setModal(null);
            setView("studio");
          }}
        />
      )}
      {modal === "accounts" && selected && (
        <ModalFrame
          title="Edit account details"
          subtitle={`Saved identifiers for ${selected.name}, not credentials.`}
          onClose={() => setModal(null)}
        >
          <AccountDetailsForm
            key={selected.id}
            brand={selected}
            onClose={() => setModal(null)}
            onVerify={setModal}
            onSave={async (domain, details) => {
              await api(`/api/brands/${selected.id}`, "PATCH", {
                domain,
                accountDetails: details,
              });
              setModal(null);
              await changed(
                "Account details saved. Connection and live-payment status are unchanged.",
              );
            }}
          />
        </ModalFrame>
      )}
      {(modal === "shopify" || modal === "whop") && selected && (
        <ConnectionModal
          provider={modal}
          brand={selected}
          enabled={
            !data.environment.demo && data.environment.credentialsConfigured
          }
          onClose={() => setModal(null)}
          onEditDetails={() => setModal("accounts")}
          onConnected={async () => {
            setModal(null);
            await changed("Connection verified and securely saved.");
          }}
        />
      )}
      {modal === "help" && (
        <ModalFrame
          title="From first brand to first order."
          subtitle="Your Limitless Checkout launch guide."
          onClose={() => setModal(null)}
        >
          <div className="help-content">
            {[
              {
                title: "Make a space for each brand",
                text: "Add your brand name, store domain, and signature color. Each brand has a separate checkout and separate connections.",
              },
              {
                title: "Make the checkout yours",
                text: "Use Checkout studio to edit your headline, announcement, shipping, and brand color. Publish a test checkout and place a no-charge test order.",
              },
              {
                title: "Secure your deployment",
                text: "Deploy on a Node.js host with a persistent disk and HTTPS. Configure admin authentication and credential encryption before entering real keys. See the repository README for exact environment variables.",
              },
              {
                title: "Connect and verify",
                text: "Create appropriately scoped Shopify custom-app credentials and connect the matching Whop business. Confirm platform approval, register signed webhooks, and run a real test purchase before sending customer traffic.",
              },
            ].map((step, index) => (
              <div className="help-step" key={step.title}>
                <span>{index + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </div>
            ))}
            <div className="soft-notice">
              <ShieldCheck size={18} />
              <p>
                No “ban-proof” promises. Shopify approval and Whop eligibility,
                processing fees, holds, and reserves remain subject to their
                policies.
              </p>
            </div>
          </div>
        </ModalFrame>
      )}
      {orderDetail && (
        <ModalFrame
          title={`Order ${orderDetail.id}`}
          subtitle={`${shortDate(orderDetail.createdAt)} · ${orderDetail.mode === "demo" ? "Test order — no charge" : "Live order"}`}
          onClose={() => setOrderDetail(null)}
        >
          <div className="order-detail">
            <div className="detail-row">
              <span>Brand</span>
              <strong>
                {data.brands.find((b) => b.id === orderDetail.brandId)?.name ??
                  "Unknown brand"}
              </strong>
            </div>
            <div className="detail-row">
              <span>Customer</span>
              <strong>{orderDetail.customer}</strong>
            </div>
            <div className="detail-row">
              <span>Email</span>
              <strong>{orderDetail.email}</strong>
            </div>
            <div className="detail-row">
              <span>Payment</span>
              <Status tone={orderDetail.status === "paid" ? "green" : "amber"}>
                {orderDetail.status}
              </Status>
            </div>
            <div className="detail-row">
              <span>Shopify sync</span>
              <strong>
                {orderDetail.syncStatus === "demo"
                  ? "Not sent · demo order"
                  : orderDetail.syncStatus}
              </strong>
            </div>
            <div className="order-items">
              {orderDetail.items.map((item, i) => (
                <div className="detail-row" key={i}>
                  <span>
                    {item.quantity} × {item.title}
                  </span>
                  <strong>{money(item.price * item.quantity)}</strong>
                </div>
              ))}
            </div>
            {orderDetail.breakdown && <div className="order-breakdown">
              <div className="detail-row"><span>Discount</span><strong>−{money(orderDetail.breakdown.discount)}</strong></div>
              <div className="detail-row"><span>Shipping</span><strong>{money(orderDetail.breakdown.shipping)}</strong></div>
              {orderDetail.breakdown.priority > 0 && <div className="detail-row"><span>Priority processing</span><strong>{money(orderDetail.breakdown.priority)}</strong></div>}
              {orderDetail.breakdown.tip > 0 && <div className="detail-row"><span>Tip</span><strong>{money(orderDetail.breakdown.tip)}</strong></div>}
            </div>}
            <div className="detail-row order-total">
              <span>Total</span>
              <strong>{money(orderDetail.total)}</strong>
            </div>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}

function Stat({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <section className="stat-card">
      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-detail">
        <span />
        {detail}
      </span>
    </section>
  );
}

function RevenueChart({ orders, days }: { orders: Order[]; days: number }) {
  const bucketCount = days === 7 ? 7 : 10;
  const buckets = Array.from({ length: bucketCount }, () => 0);
  const start = Date.now() - days * 86400000;
  orders.forEach((order) => {
    const index = Math.min(
      bucketCount - 1,
      Math.max(
        0,
        Math.floor(
          (new Date(order.createdAt).getTime() - start) /
            ((days * 86400000) / bucketCount),
        ),
      ),
    );
    buckets[index] += order.total;
  });
  const max = Math.max(100, Math.ceil(Math.max(...buckets) / 100) * 100);
  const points = buckets.map(
    (value, i) =>
      `${56 + (i * 650) / (bucketCount - 1)},${174 - (value / max) * 140}`,
  );
  const path = `M ${points.join(" L ")}`;
  const dates = [
    days,
    Math.round(days * 0.75),
    Math.round(days * 0.5),
    Math.round(days * 0.25),
    0,
  ];
  return (
    <div className="revenue-chart">
      <svg
        viewBox="0 0 740 215"
        role="img"
        aria-label={`Revenue across the last ${days} days. Total ${money(orders.reduce((sum, o) => sum + o.total, 0))}.`}
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-muted)" stopOpacity=".65" />
            <stop offset="100%" stopColor="var(--accent-soft)" stopOpacity=".05" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1="56"
              x2="708"
              y1={174 - fraction * 140}
              y2={174 - fraction * 140}
              stroke="var(--line)"
              strokeDasharray="4 5"
            />
            <text x="0" y={178 - fraction * 140} fill="var(--muted)" fontSize="10">
              ${Math.round(max * fraction)}
            </text>
          </g>
        ))}
        <path d={`${path} L 706,174 L 56,174 Z`} fill="url(#chart-fill)" />
        <path
          d={path}
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        />
        {buckets.map((value, i) => (
          <circle
            key={i}
            cx={56 + (i * 650) / (bucketCount - 1)}
            cy={174 - (value / max) * 140}
            r="3"
            fill="var(--accent)"
          >
            <title>{money(value)}</title>
          </circle>
        ))}
        {dates.map((date, i) => (
          <text
            key={i}
            x={56 + (i * 650) / 4}
            y="207"
            textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
            fill="var(--muted)"
            fontSize="10"
          >
            {shortDate(new Date(Date.now() - date * 86400000).toISOString())}
          </text>
        ))}
      </svg>
    </div>
  );
}

function ActivityList({ data }: { data: AppState }) {
  return (
    <div className="activity-list">
      {data.activity.slice(0, 4).map((activity) => (
        <div key={activity.id} className="activity-item">
          <span className={`activity-icon ${activity.type}`}>
            {activity.type === "order" ? (
              <ShoppingBag size={14} />
            ) : activity.type === "connection" ? (
              <Link2 size={14} />
            ) : (
              <Sparkles size={14} />
            )}
          </span>
          <div>
            <p>{activity.message}</p>
            <span>
              {shortDate(activity.createdAt)}
              {activity.brandId &&
                ` · ${data.brands.find((b) => b.id === activity.brandId)?.name ?? "Brand"}`}
            </span>
          </div>
        </div>
      ))}
      {!data.activity.length && (
        <p className="muted">
          Your next chapter starts here. Add a brand to get going.
        </p>
      )}
    </div>
  );
}

function BrandCard({
  brand,
  orders,
  onCustomize,
  onConnect,
}: {
  brand: Brand;
  orders: Order[];
  onCustomize: () => void;
  onConnect: () => void;
}) {
  const brandOrders = orders.filter(
    (order) => order.brandId === brand.id && order.status === "paid",
  );
  const connectionCount = [brand.shopify, brand.whop].filter(
    (c) => c.status === "verified",
  ).length;
  return (
    <article className="brand-card">
      <div className="brand-card-top">
        <span className="brand-avatar" style={{ background: brand.accent }}>
          {brand.logoInitial}
        </span>
        <Status
          tone={
            brand.mode === "live" && brand.status === "live"
              ? "green"
              : "neutral"
          }
        >
          {brand.mode === "demo"
            ? "Test mode"
            : brand.status === "live"
              ? "Live"
              : "Draft"}
        </Status>
        <button
          className="icon-button brand-menu"
          aria-label={`Manage ${brand.name} connections`}
          onClick={onConnect}
        >
          <MoreHorizontal size={19} />
        </button>
      </div>
      <div className="brand-identity">
        <h3>{brand.name}</h3>
        <span>
          {brand.category || "Your next brand"}
          <span className="middle-dot">·</span>
          {brand.domain || "No store connected"}
        </span>
      </div>
      <div className="brand-card-metrics">
        <div>
          <span>Revenue</span>
          <strong>
            {money(brandOrders.reduce((sum, order) => sum + order.total, 0))}
          </strong>
        </div>
        <div>
          <span>Orders</span>
          <strong>{brandOrders.length}</strong>
        </div>
        <div className="brand-integrations">
          <div>
            <ProviderLogo provider="shopify" />
            <ProviderLogo provider="whop" />
          </div>
          <button onClick={onConnect}>{connectionCount}/2 connected</button>
        </div>
      </div>
      <div className="brand-card-bottom">
        <button className="button secondary" onClick={onCustomize}>
          <Palette size={14} />
          Customize checkout
        </button>
        <a
          className="button preview-icon"
          href={`/checkout/${brand.slug}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Preview ${brand.name} checkout`}
          title="Open full checkout example"
        >
          <ArrowUpRight size={17} />
        </a>
      </div>
    </article>
  );
}

function BrandSwitcher({
  brands,
  selected,
  onSelect,
}: {
  brands: Brand[];
  selected: Brand;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="brand-switcher">
      <label htmlFor="selected-brand">WORKING ON</label>
      <span
        className="brand-avatar tiny"
        style={{ background: selected.accent }}
      >
        {selected.logoInitial}
      </span>
      <select
        id="selected-brand"
        value={selected.id}
        onChange={(e) => onSelect(e.target.value)}
      >
        {brands.map((brand) => (
          <option value={brand.id} key={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>
      <ChevronDown size={15} />
      <Status tone={selected.mode === "demo" ? "neutral" : "green"}>
        {selected.mode === "demo" ? "Test mode" : selected.status}
      </Status>
    </div>
  );
}

function Studio({
  brand,
  onSaved,
  onPublish,
  busy,
}: {
  brand: Brand;
  onSaved: (message: string) => Promise<void>;
  onPublish: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(brand);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(brand);
  useEffect(() => {
    setDraft(brand);
  }, [brand]);
  const update = (key: keyof Brand, value: string | number) =>
    setDraft((old) => ({ ...old, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/brands/${brand.id}`, "PATCH", {
        name: draft.name,
        accent: draft.accent,
        checkoutTitle: draft.checkoutTitle,
        announcement: draft.announcement,
        supportEmail: draft.supportEmail,
        shippingPrice: draft.shippingPrice,
        freeShippingThreshold: draft.freeShippingThreshold,
        checkoutExperience: checkoutExperience(draft),
      });
      await onSaved("Checkout changes saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="studio-layout">
      <form className="panel studio-editor" onSubmit={save}>
        <div className="editor-heading">
          <span className="studio-icon">
            <SlidersHorizontal size={18} />
          </span>
          <div>
            <h2>The details make it yours.</h2>
            <p>Signature checkout template</p>
          </div>
        </div>
        <div className="editor-section">
          <h3>Brand identity</h3>
          <label className="field">
            Brand name
            <input
              required
              maxLength={80}
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>
          <label className="field">
            Signature color
            <span className="color-input">
              <input
                aria-label="Pick brand color"
                type="color"
                value={draft.accent}
                onChange={(e) => update("accent", e.target.value)}
              />
              <input
                aria-label="Brand color hex"
                pattern="#[0-9a-fA-F]{6}"
                value={draft.accent}
                onChange={(e) => update("accent", e.target.value)}
              />
            </span>
          </label>
          <div className="palette-swatches">
            {[
              "#3c5143",
              "#9b6349",
              "#55617b",
              "#272724",
              "#7d5267",
              "#776e45",
            ].map((color) => (
              <button
                type="button"
                key={color}
                aria-label={`Use ${color}`}
                aria-pressed={draft.accent === color}
                style={{ background: color }}
                onClick={() => update("accent", color)}
              >
                {draft.accent === color && <Check size={15} />}
              </button>
            ))}
          </div>
        </div>
        <div className="editor-section">
          <h3>Words that welcome</h3>
          <label className="field">
            Checkout headline
            <input
              required
              maxLength={120}
              value={draft.checkoutTitle}
              onChange={(e) => update("checkoutTitle", e.target.value)}
            />
          </label>
          <label className="field">
            Announcement
            <textarea
              maxLength={180}
              value={draft.announcement}
              onChange={(e) => update("announcement", e.target.value)}
              rows={2}
            />
          </label>
          <label className="field">
            Support email
            <input
              type="email"
              value={draft.supportEmail}
              onChange={(e) => update("supportEmail", e.target.value)}
              placeholder="hello@yourbrand.com"
            />
          </label>
        </div>
        <div className="editor-section">
          <h3>Shipping · USD</h3>
          <div className="field-row">
            <label className="field">
              Flat rate
              <input
                required
                type="number"
                min="0"
                max="1000"
                step="0.01"
                value={draft.shippingPrice}
                onChange={(e) =>
                  update("shippingPrice", Number(e.target.value))
                }
              />
            </label>
            <label className="field">
              Free above
              <input
                required
                type="number"
                min="0"
                max="10000"
                step="0.01"
                value={draft.freeShippingThreshold}
                onChange={(e) =>
                  update("freeShippingThreshold", Number(e.target.value))
                }
              />
            </label>
          </div>
          <p className="field-hint">
            Use 0 for always-free shipping. Tax calculation is not included in
            the test checkout.
          </p>
        </div>
        <CheckoutSettings
          brand={draft}
          value={checkoutExperience(draft)}
          onChange={experience => setDraft(current => ({ ...current, checkoutExperience: experience }))}
        />
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="editor-actions">
          <button
            className="button primary full-width"
            disabled={saving || !dirty}
          >
            {saving ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            {saving ? "Saving…" : dirty ? "Save changes" : "All changes saved"}
          </button>
        </div>
      </form>
      <div className="studio-preview-area">
        <div className="preview-toolbar">
          <span>
            <span className="preview-dot" />
            {dirty ? "Unsaved preview" : "Checkout preview"}
          </span>
          <a href={`/checkout/${brand.slug}`} target="_blank" rel="noreferrer">
            Open checkout <ExternalLink size={14} />
          </a>
        </div>
        <div className="browser-frame">
          <div className="browser-toolbar">
            <span />
            <span />
            <span />
            <div>
              <LockKeyhole size={10} />
              checkout / {brand.slug}
            </div>
          </div>
          <CheckoutPreview brand={draft} />
        </div>
        <div className="preview-bottom">
          <span>
            <ShieldCheck size={15} />A real test order. Never a real charge.
          </span>
          <button
            className="button secondary"
            type="button"
            disabled={busy || dirty}
            onClick={onPublish}
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Globe size={15} />
            )}
            {brand.status === "live" && brand.mode === "demo"
              ? "Republish test checkout"
              : "Publish test checkout"}
          </button>
        </div>
        <div className="studio-tip">
          <Sparkles size={18} />
          <div>
            <strong>Good design gets out of the way.</strong>
            <p>
              One clear page. A recognizable brand. Everything your customer
              needs to feel confident.
            </p>
          </div>
        </div>
        <TestCatalog brand={brand} onSaved={onSaved} />
      </div>
    </div>
  );
}

function TestCatalog({
  brand,
  onSaved,
}: {
  brand: Brand;
  onSaved: (message: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("29.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <div className="panel test-catalog">
        <div>
          <h3>Make a test order your own.</h3>
          <p>
            {brand.products.length} products available in this brand’s catalog.
            Add a test product without connecting a store.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => setOpen(true)}
        >
          <Plus size={14} />
          Add test product
        </button>
      </div>
      {open && (
        <ModalFrame
          title="Something worth checking out."
          subtitle={`Add a test product for ${brand.name}.`}
          onClose={() => setOpen(false)}
        >
          <form
            className="wizard-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api(`/api/brands/${brand.id}/products`, "POST", {
                  title,
                  description,
                  price: Number(price),
                });
                await onSaved(
                  "Test product added. Your checkout is ready to try.",
                );
                setOpen(false);
                setTitle("");
                setDescription("");
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Could not add product.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Product name
              <input
                autoFocus
                required
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Your everyday essential"
              />
            </label>
            <label className="field">
              Description
              <textarea
                maxLength={500}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What makes it special?"
              />
            </label>
            <label className="field">
              Price · USD
              <input
                required
                type="number"
                min="0.01"
                max="100000"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            <p className="field-hint">
              Test products are never sent to Shopify. Import your real catalog
              from Connections before any future live launch.
            </p>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <div className="modal-footer">
              <button
                className="button ghost"
                type="button"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Plus size={15} />
                )}
                {busy ? "Adding…" : "Add test product"}
              </button>
            </div>
          </form>
        </ModalFrame>
      )}
    </>
  );
}

function OrdersTable({
  data,
  onDetail,
}: {
  data: AppState;
  onDetail: (order: Order) => void;
}) {
  const [query, setQuery] = useState("");
  const [brandId, setBrandId] = useState("");
  const [page, setPage] = useState(0);
  const filtered = data.orders.filter(
    (order) =>
      (!brandId || order.brandId === brandId) &&
      `${order.id} ${order.customer} ${order.email}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const actualPage = Math.min(page, pageCount - 1);
  function exportOrders() {
    const safeCell = (value: string | number) =>
      `"${String(value)
        .replace(/^[=+@-]/, "'$&")
        .replace(/"/g, '""')}"`;
    const csv = [
      [
        "Order",
        "Brand",
        "Customer",
        "Email",
        "Total USD",
        "Payment",
        "Sync",
        "Mode",
        "Date",
      ],
      ...filtered.map((order) => [
        order.id,
        data.brands.find((b) => b.id === order.brandId)?.name ?? "",
        order.customer,
        order.email,
        order.total,
        order.status,
        order.syncStatus,
        order.mode,
        order.createdAt,
      ]),
    ]
      .map((row) => row.map(safeCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "limitless-orders.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="panel orders-panel">
      <div className="list-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search orders or customers…"
            aria-label="Search orders"
          />
        </label>
        <div className="order-filters">
          <select
            aria-label="Filter by brand"
            value={brandId}
            onChange={(e) => {
              setBrandId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All brands</option>
            {data.brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
          <button className="button secondary" onClick={exportOrders}>
            <ArrowDownToLine size={15} />
            Export
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Brand</th>
              <th>Amount</th>
              <th>Payment</th>
              <th>Shopify sync</th>
              <th>Date</th>
              <th>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered
              .slice(actualPage * 10, actualPage * 10 + 10)
              .map((order) => (
                <tr key={order.id}>
                  <td>
                    <button
                      className="order-id"
                      onClick={() => onDetail(order)}
                    >
                      {order.id.length > 17
                        ? `${order.id.slice(0, 14)}…`
                        : order.id}
                    </button>
                    {order.mode === "demo" && (
                      <span className="test-label">TEST</span>
                    )}
                  </td>
                  <td>
                    <strong>{order.customer}</strong>
                    <span className="table-sub">{order.email}</span>
                  </td>
                  <td>
                    {data.brands.find((b) => b.id === order.brandId)?.name}
                  </td>
                  <td className="amount-cell">{money(order.total)}</td>
                  <td>
                    <Status tone={order.status === "paid" ? "green" : "amber"}>
                      {order.status}
                    </Status>
                  </td>
                  <td>
                    <span className={`sync-label ${order.syncStatus}`}>
                      <span />
                      {order.syncStatus === "demo"
                        ? "Not sent · test"
                        : order.syncStatus}
                    </span>
                  </td>
                  <td className="date-cell">{shortDate(order.createdAt)}</td>
                  <td>
                    <button
                      className="icon-button"
                      onClick={() => onDetail(order)}
                      aria-label={`View order ${order.id}`}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <EmptyState
          title="No orders here yet"
          description="Place a test order from a brand’s checkout, or try a different filter."
        />
      )}
      <div className="table-footer">
        <span>
          {filtered.length} orders
          {data.environment.demo ? " · Sample and test data only" : ""}
        </span>
        <div>
          <button
            className="icon-button"
            disabled={actualPage === 0}
            aria-label="Previous page"
            onClick={() => setPage(actualPage - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {actualPage + 1} / {pageCount}
          </span>
          <button
            className="icon-button"
            disabled={actualPage + 1 >= pageCount}
            aria-label="Next page"
            onClick={() => setPage(actualPage + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}

function BrandWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (brand: Brand) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Skincare & beauty");
  const [domain, setDomain] = useState("");
  const [shopifyDomain, setShopifyDomain] = useState("");
  const [whopCompanyId, setWhopCompanyId] = useState("");
  const [accent, setAccent] = useState("#3c5143");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (step === 1) {
      setStep(2);
      return;
    }
    setSaving(true);
    try {
      const brand = await api<Brand>("/api/brands", "POST", {
        name,
        category,
        domain,
        accent,
        accountDetails: {
          shopifyDomain,
          whopCompanyId,
          shopifyAliases: [],
          storefrontAliases: [],
          customerAccountDomain: "",
        },
      });
      await onCreated(brand);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create brand.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <ModalFrame
      title="Room for your next big thing."
      subtitle="Give your brand a home in Limitless."
      onClose={onClose}
    >
      <form onSubmit={submit} className="wizard-form">
        <div className="wizard-steps">
          <span className={step === 1 ? "current" : "complete"}>
            <i>{step > 1 ? <Check size={12} /> : "1"}</i>Brand details
          </span>
          <div />
          <span className={step === 2 ? "current" : ""}>
            <i>2</i>Your identity
          </span>
        </div>
        {step === 1 ? (
          <>
            <label className="field">
              Brand name
              <input
                autoFocus
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Auré Studio"
              />
            </label>
            <label className="field">
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {[
                  "Skincare & beauty",
                  "Home & living",
                  "Clothing & accessories",
                  "Health & wellness",
                  "Food & beverage",
                  "Essentials",
                  "Other",
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Primary storefront domain{" "}
              <span className="optional">optional for now</span>
              <input
                maxLength={253}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="your-brand.com"
              />
            </label>
            <label className="field">
              Shopify API domain <span className="optional">optional</span>
              <input
                maxLength={253}
                value={shopifyDomain}
                onChange={(e) => setShopifyDomain(e.target.value)}
                placeholder="your-brand.myshopify.com"
              />
            </label>
            <label className="field">
              Whop business ID <span className="optional">optional</span>
              <input
                maxLength={100}
                value={whopCompanyId}
                onChange={(e) => setWhopCompanyId(e.target.value)}
                placeholder="biz_…"
              />
            </label>
            <p className="field-hint">
              <LockKeyhole size={12} />
              The storefront is your public address; Shopify uses a
              .myshopify.com API domain. Save your Whop business ID, never an
              API key. These identifiers do not connect accounts or enable
              payments. Add aliases later in Connections → Edit account details.
            </p>
          </>
        ) : (
          <>
            <div className="brand-identity-preview">
              <span className="brand-avatar" style={{ background: accent }}>
                {name.charAt(0).toUpperCase()}
              </span>
              <div>
                <h3>{name}</h3>
                <p>{category}</p>
              </div>
              <Status>New brand</Status>
            </div>
            <label className="field">
              Choose your signature color
              <span className="color-input">
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  aria-label="Signature color"
                />
                <input
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  pattern="#[0-9a-fA-F]{6}"
                  required
                  aria-label="Signature color hex"
                />
              </span>
            </label>
            <div className="soft-notice">
              <Sparkles size={20} />
              <div>
                <strong>Start in test mode. Make it yours.</strong>
                <p>
                  We’ll create a draft checkout. Add products through Shopify,
                  verify your Whop account, and review launch requirements
                  before accepting real payments.
                </p>
              </div>
            </div>
          </>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button
            className="button ghost"
            type="button"
            onClick={step === 1 ? onClose : () => setStep(1)}
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          <button className="button primary" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : null}
            {step === 1
              ? "Next, make it yours"
              : saving
                ? "Creating brand…"
                : "Create brand"}
            {!saving && <ArrowRight size={15} />}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

function ConnectionModal({
  provider,
  brand,
  enabled,
  onClose,
  onConnected,
  onEditDetails,
}: {
  provider: "shopify" | "whop";
  brand: Brand;
  enabled: boolean;
  onClose: () => void;
  onConnected: () => Promise<void>;
  onEditDetails: () => void;
}) {
  const details = accountDetails(brand);
  const [account, setAccount] = useState(
    provider === "shopify" ? details.shopifyDomain : details.whopCompanyId,
  );
  const [secret, setSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [shopifyAuth, setShopifyAuth] = useState<"client_credentials" | "access_token">("client_credentials");
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!enabled) return;
    setSaving(true);
    setError("");
    try {
      await api(
        `/api/brands/${brand.id}/connections`,
        "POST",
        provider === "shopify"
          ? shopifyAuth === "client_credentials"
            ? { provider, domain: account, authMethod: shopifyAuth, clientId, clientSecret: secret }
            : { provider, domain: account, accessToken: secret }
          : {
              provider,
              companyId: account,
              apiKey: secret,
              ...(webhookSecret ? { webhookSecret } : {}),
            },
      );
      setSecret("");
      setClientId("");
      setWebhookSecret("");
      await onConnected();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not verify connection.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <ModalFrame
      title={`Connect ${provider === "shopify" ? "Shopify" : "Whop"}`}
      subtitle={`A dedicated connection for ${brand.name}.`}
      onClose={onClose}
    >
      <form className="connection-form" onSubmit={submit}>
        <div className="account-details-replacement">
          <p>
            Only saving IDs? Edit account details without entering keys.
            Selecting an identifier here does not verify it.
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={onEditDetails}
          >
            Edit account details
          </button>
        </div>
        {provider === "shopify" &&
          !details.shopifyDomain &&
          details.shopifyAliases.length > 0 && (
            <div className="account-details-candidates">
              <p>
                Confirm which known alias is the correct Shopify API domain.
                Choose a candidate for verification:
              </p>
              {details.shopifyAliases.map((alias) => (
                <button
                  type="button"
                  className="button secondary"
                  key={alias}
                  aria-pressed={account === alias}
                  onClick={() => setAccount(alias)}
                >
                  {alias}
                </button>
              ))}
              <p className="field-hint">
                This selection is not saved or verified until verification
                succeeds.
              </p>
            </div>
          )}
        {!enabled && (
          <div className="soft-notice">
            <LockKeyhole size={21} />
            <div>
              <strong>Real credentials stay out of the demo.</strong>
              <p>
                Configure admin authentication and encryption on your private
                deployment first. This preview never accepts or stores real
                provider keys.
              </p>
            </div>
          </div>
        )}
        <label className="field">
          {provider === "shopify"
            ? "Shopify .myshopify.com domain"
            : "Whop company ID"}
          <input
            required
            disabled={!enabled}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder={
              provider === "shopify" ? "your-brand.myshopify.com" : "biz_…"
            }
          />
        </label>
        {provider === "shopify" && <>
          <label className="field">Shopify connection method
            <select disabled={!enabled || saving} value={shopifyAuth} onChange={e => { setShopifyAuth(e.target.value as typeof shopifyAuth); setSecret(""); setError(""); }}>
              <option value="client_credentials">Dev Dashboard app (automatic token renewal)</option>
              <option value="access_token">Existing Admin API access token</option>
            </select>
          </label>
          {shopifyAuth === "client_credentials" && <label className="field">Client ID
            <input required disabled={!enabled || saving} autoComplete="off" value={clientId} onChange={e => setClientId(e.target.value)} />
          </label>}
        </>}
        <label className="field">
          {provider === "shopify" ? shopifyAuth === "client_credentials" ? "Client secret" : "Admin API access token" : "Whop API key"}
          <input
            type="password"
            autoComplete="off"
            required
            disabled={!enabled}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Kept encrypted. Never shared with shoppers."
          />
        </label>
        {provider === "whop" && (
          <label className="field">
            Webhook signing secret{" "}
            <span className="optional">for live payment events</span>
            <input
              type="password"
              autoComplete="off"
              disabled={!enabled}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="Your endpoint’s signing secret"
            />
          </label>
        )}
        <p className="field-hint">
          {provider === "shopify"
            ? shopifyAuth === "client_credentials"
              ? "Install this brand’s app on its store first. The app and store must belong to the same eligible Shopify organization. Find Client ID and Client secret under the app’s Settings. Tokens renew automatically; grant read_products and read_inventory for catalog import."
              : "Enter an existing Admin API access token, not a Client secret. This method does not renew expiring tokens. Grant read_products and read_inventory for catalog import."
            : "Use an API key scoped to this brand’s Whop business. Verification does not move funds or change payouts."}
        </p>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!enabled || saving}>
            {saving ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <ShieldCheck size={15} />
            )}
            {saving ? "Verifying…" : "Verify connection"}
          </button>
        </div>
        {provider === "shopify" && brand.shopify.status === "verified" && (
          <button
            className="button secondary full-width"
            type="button"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              setError("");
              try {
                await api(`/api/brands/${brand.id}/products/sync`, "POST", {});
                await onConnected();
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Could not sync products.",
                );
              } finally {
                setSyncing(false);
              }
            }}
          >
            {syncing ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Package size={15} />
            )}
            Sync Shopify products
          </button>
        )}
      </form>
    </ModalFrame>
  );
}

function SettingsPanel({
  data,
  onLogout,
  onHelp,
}: {
  data: AppState;
  onLogout: () => void;
  onHelp: () => void;
}) {
  const checks = [
    {
      title: "Private admin access",
      description: "Password-protected workspace with an expiring session.",
      complete: data.environment.authenticated && !data.environment.demo,
    },
    {
      title: "Encrypted credentials",
      description:
        "A server-only encryption key protects Shopify and Whop secrets.",
      complete: data.environment.credentialsConfigured,
    },
    {
      title: "Brand accounts verified",
      description:
        "Every brand needs its own verified Shopify and Whop account.",
      complete:
        data.brands.length > 0 &&
        data.brands.every(
          (b) =>
            b.shopify.status === "verified" && b.whop.status === "verified",
        ),
    },
    {
      title: "Live checkout infrastructure",
      description:
        "Public HTTPS, approved integration, payment webhooks, and order delivery.",
      complete: data.environment.liveEnabled,
    },
  ];
  return (
    <div className="settings-layout">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Your launch checklist</h2>
            <p>Clear steps. No shortcuts with your money.</p>
          </div>
          <span className="tiny-label">
            {checks.filter((c) => c.complete).length} / {checks.length} READY
          </span>
        </div>
        <div className="readiness-list">
          {checks.map((check) => (
            <div className="readiness-item" key={check.title}>
              <span
                className={`readiness-check ${check.complete ? "complete" : ""}`}
              >
                {check.complete ? (
                  <Check size={16} />
                ) : (
                  <LockKeyhole size={14} />
                )}
              </span>
              <div>
                <h3>{check.title}</h3>
                <p>{check.description}</p>
              </div>
              <span
                className={`readiness-state ${check.complete ? "complete" : ""}`}
              >
                {check.complete ? "Ready" : "Required"}
              </span>
            </div>
          ))}
        </div>
        <div className="settings-panel-footer">
          <button className="button secondary" onClick={onHelp}>
            Read setup guide <ArrowUpRight size={15} />
          </button>
        </div>
      </section>
      <section className="panel workspace-settings">
        <span className="settings-hero-icon">
          <InfinityIcon size={31} />
        </span>
        <h2>
          Your brands.
          <br />
          Your workspace.
        </h2>
        <p>
          Limitless is your private multi-brand control center. No platform
          subscription is charged by this application.
        </p>
        <div className="detail-row">
          <span>Environment</span>
          <Status tone={data.environment.demo ? "neutral" : "green"}>
            {data.environment.demo ? "Demo" : "Private"}
          </Status>
        </div>
        <div className="detail-row">
          <span>Brands</span>
          <strong>{data.brands.length}</strong>
        </div>
        <div className="detail-row">
          <span>Currency</span>
          <strong>USD</strong>
        </div>
        {!data.environment.demo && (
          <button className="button secondary full-width" onClick={onLogout}>
            Sign out securely <LockKeyhole size={15} />
          </button>
        )}
        <p className="field-hint">
          One-time purchases are the initial scope. Subscription billing,
          refunds, custom domains, and automated OAuth onboarding require
          additional implementation.
        </p>
      </section>
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Package size={25} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [embedded, setEmbedded] = useState<boolean | null>(null);
  useEffect(() => {
    setEmbedded(isEmbeddedWorkspace());
  }, []);
  return (
    <main className="login-screen">
      <div className="login-decoration">
        <InfinityIcon size={85} strokeWidth={1} />
        <h1>
          Your brands.
          <br />
          Without limits.
        </h1>
        <p>
          A little less managing.
          <br />A lot more growing.
        </p>
      </div>
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/api/auth/login", "POST", { password });
            await onSuccess();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Sign-in failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="brand-symbol">
          <InfinityIcon size={28} />
        </span>
        <h2>{embedded ? "Open your secure workspace." : "Welcome back."}</h2>
        <p>
          {embedded
            ? "Embedded previews can block the security cookies needed for private sign-in. Open Limitless in its own tab to continue."
            : "Your workspace is right where you left it."}
        </p>
        {embedded ? (
          <a
            className="button primary full-width"
            href="/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={16} />
            Open secure sign-in
          </a>
        ) : (
          <>
            <label className="field">
              Workspace password
              <input
                type="password"
                autoComplete="current-password"
                required
                disabled={embedded === null}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            <button
              className="button primary full-width"
              disabled={busy || embedded === null}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <ArrowRight size={16} />
              )}
              Open workspace
            </button>
          </>
        )}
        <span className="login-secure">
          <LockKeyhole size={12} />
          Private access for your brand team.
        </span>
      </form>
    </main>
  );
}
