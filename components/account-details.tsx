"use client";

import { useState, type FormEvent } from "react";
import { LoaderCircle, Settings2 } from "lucide-react";
import { accountDetails } from "@/lib/accounts";
import type { AccountDetails, Brand } from "@/lib/types";

export function AccountDetailsSummary({
  brand,
  onEdit,
}: {
  brand: Brand;
  onEdit: () => void;
}) {
  const details = accountDetails(brand);
  return (
    <section className="panel account-details-summary">
      <div className="account-details-heading">
        <div>
          <h2>Saved account details</h2>
          <p>
            Identifiers only. Saving these does not verify a connection or
            enable live payments.
          </p>
        </div>
        <button className="button secondary" onClick={onEdit}>
          <Settings2 size={15} /> Edit account details
        </button>
      </div>
      <dl className="account-details-list">
        <div>
          <dt>Primary storefront</dt>
          <dd>{brand.domain || "Not added"}</dd>
        </div>
        <div>
          <dt>Primary Shopify API domain</dt>
          <dd>
            {details.shopifyDomain ||
              "Not selected — confirm the correct .myshopify.com domain"}
          </dd>
        </div>
        <div>
          <dt>Known Shopify aliases</dt>
          <dd>{details.shopifyAliases.join(", ") || "None added"}</dd>
        </div>
        <div>
          <dt>Whop business ID</dt>
          <dd>
            {details.whopCompanyId || "Not added — needed to connect Whop"}
          </dd>
        </div>
        <div>
          <dt>Storefront aliases</dt>
          <dd>{details.storefrontAliases.join(", ") || "None added"}</dd>
        </div>
        <div>
          <dt>Customer account domain</dt>
          <dd>{details.customerAccountDomain || "Not added"}</dd>
        </div>
      </dl>
      <p className="field-hint">
        Connection verification status is shown separately below. Aliases are
        reference details, not verified API accounts.
      </p>
    </section>
  );
}

export function AccountDetailsForm({
  brand,
  onSave,
  onClose,
  onVerify,
}: {
  brand: Brand;
  onSave: (domain: string, details: AccountDetails) => Promise<void>;
  onClose: () => void;
  onVerify: (provider: "shopify" | "whop") => void;
}) {
  const [details, setDetails] = useState(() => accountDetails(brand));
  const [domain, setDomain] = useState(brand.domain);
  const [shopifyAliases, setShopifyAliases] = useState(
    details.shopifyAliases.join("\n"),
  );
  const [storefrontAliases, setStorefrontAliases] = useState(
    details.storefrontAliases.join("\n"),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const aliases = (value: string) => [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(domain.trim(), {
        ...details,
        shopifyDomain: details.shopifyDomain.trim(),
        whopCompanyId: details.whopCompanyId.trim(),
        customerAccountDomain: details.customerAccountDomain.trim(),
        shopifyAliases: aliases(shopifyAliases),
        storefrontAliases: aliases(storefrontAliases),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save account details.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="connection-form account-details-form" onSubmit={submit}>
      <p className="soft-notice">
        Save domains and business IDs here, including in demo mode. Never enter
        passwords, API keys, or access tokens in these fields.
      </p>
      <label className="field">
        Primary storefront domain (optional)
        <input
          autoFocus
          maxLength={253}
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="your-brand.com"
        />
      </label>
      <p className="field-hint">
        Your public store address, separate from the Shopify API domain.
      </p>
      <label className="field">
        Primary Shopify API domain (optional)
        <input
          maxLength={253}
          list="account-shopify-aliases"
          value={details.shopifyDomain}
          onChange={(e) =>
            setDetails({ ...details, shopifyDomain: e.target.value })
          }
          placeholder="your-brand.myshopify.com"
        />
        <datalist id="account-shopify-aliases">
          {aliases(shopifyAliases).map((alias) => (
            <option key={alias} value={alias} />
          ))}
        </datalist>
      </label>
      {!details.shopifyDomain && (
        <p className="field-hint">
          If multiple aliases are known, confirm the correct API domain before
          choosing a primary. It is safe to leave this blank.
        </p>
      )}
      <label className="field">
        Known Shopify aliases (one per line)
        <textarea
          rows={3}
          value={shopifyAliases}
          onChange={(e) => setShopifyAliases(e.target.value)}
          placeholder="other-store.myshopify.com"
        />
      </label>
      <label className="field">
        Whop business ID (optional)
        <input
          maxLength={100}
          value={details.whopCompanyId}
          onChange={(e) =>
            setDetails({ ...details, whopCompanyId: e.target.value })
          }
          placeholder="biz_…"
        />
      </label>
      <p className="field-hint">
        The business identifier from Whop, not your API key or a checkout link.
      </p>
      <label className="field">
        Storefront aliases (one per line)
        <textarea
          rows={2}
          value={storefrontAliases}
          onChange={(e) => setStorefrontAliases(e.target.value)}
          placeholder="www.your-brand.com"
        />
      </label>
      <label className="field">
        Customer account domain (optional)
        <input
          maxLength={253}
          value={details.customerAccountDomain}
          onChange={(e) =>
            setDetails({ ...details, customerAccountDomain: e.target.value })
          }
          placeholder="account.your-brand.com"
        />
      </label>
      {(["shopify", "whop"] as const)
        .filter((provider) => brand[provider].status === "verified")
        .map((provider) => (
          <div className="account-details-replacement" key={provider}>
            <p>
              Replacing the verified{" "}
              {provider === "shopify" ? "Shopify" : "Whop"} account? Verify the
              replacement in Connections first. Your existing credentials remain
              unchanged when you save details.
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={saving}
              onClick={() => onVerify(provider)}
            >
              Verify replacement {provider === "shopify" ? "Shopify" : "Whop"}{" "}
              account
            </button>
            <p className="field-hint">
              Opens verification without saving this form.
            </p>
          </div>
        ))}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-footer">
        <button
          type="button"
          className="button ghost"
          disabled={saving}
          onClick={onClose}
        >
          Cancel
        </button>
        <button className="button primary" disabled={saving}>
          {saving && <LoaderCircle className="spin" size={15} />}
          {saving ? "Saving…" : "Save account details"}
        </button>
      </div>
    </form>
  );
}
