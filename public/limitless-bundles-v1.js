(function (global) {
  "use strict";

  var TIERS = Object.freeze([
    Object.freeze({ key: "solo", quantity: 1, discount: 0, utilityLabel: "Buy 1", facejamasLabel: "Solo", badge: "" }),
    Object.freeze({ key: "duo", quantity: 2, discount: 0.10, utilityLabel: "Buy 2", facejamasLabel: "Duo", badge: "Save 10%" }),
    Object.freeze({ key: "trio", quantity: 3, discount: 0.15, utilityLabel: "Buy 3", facejamasLabel: "Trio", badge: "Save 15%" }),
    Object.freeze({ key: "family", quantity: 4, discount: 0.20, utilityLabel: "Buy 4", facejamasLabel: "Family Pack", badge: "Best value · Save 20%" })
  ]);

  function money(cents) {
    return "$" + (cents / 100).toFixed(2);
  }

  function cents(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Limitless Bundles: unitPrice must be a positive number");
    return Math.round(n * 100);
  }

  function tierPrice(unitCents, tier) {
    return Math.round(unitCents * tier.quantity * (1 - tier.discount));
  }

  function offerModel(options) {
    options = options || {};
    var unitCents = cents(options.unitPrice);
    var facejamas = options.brandSlug === "facejamas";
    return TIERS.map(function (tier) {
      var regular = unitCents * tier.quantity;
      var total = tierPrice(unitCents, tier);
      return {
        key: tier.key,
        quantity: tier.quantity,
        label: facejamas ? tier.facejamasLabel : tier.utilityLabel,
        subtitle: facejamas
          ? (tier.quantity === 1 ? "Just for you" : tier.quantity === 2 ? "Couples or best friends" : tier.quantity === 3 ? "Friends, siblings or a trio" : "Families and groups")
          : (tier.quantity === 1 ? "Single" : tier.quantity + " items"),
        badge: tier.badge,
        discountPercent: Math.round(tier.discount * 100),
        regularCents: regular,
        totalCents: total,
        savingsCents: regular - total,
        perItemCents: Math.round(total / tier.quantity)
      };
    });
  }

  function render(options) {
    options = options || {};
    var root = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
    if (!root || typeof root.appendChild !== "function") throw new Error("Limitless Bundles: root element not found");
    var offers = offerModel(options);
    var selected = String(options.selected || "solo");
    if (!offers.some(function (offer) { return offer.key === selected; })) selected = "solo";

    root.innerHTML = "";
    root.setAttribute("data-limitless-bundles", options.brandSlug || "store");

    var style = document.createElement("style");
    style.textContent = "[data-limitless-bundles]{display:grid;gap:10px;font-family:inherit}[data-limitless-bundle]{position:relative;display:grid;grid-template-columns:1fr auto;gap:4px 16px;align-items:center;border:1.5px solid rgba(20,20,20,.16);border-radius:14px;padding:14px 16px;background:#fff;cursor:pointer;transition:.16s ease}[data-limitless-bundle]:hover{border-color:rgba(20,20,20,.4)}[data-limitless-bundle][aria-checked=true]{border-color:#111;box-shadow:0 0 0 1px #111}[data-limitless-bundle] strong{font-size:15px}[data-limitless-bundle] small{opacity:.66;font-size:12px}[data-limitless-bundle-price]{font-weight:700;text-align:right}[data-limitless-bundle-price] small{display:block;font-weight:500}[data-limitless-badge]{position:absolute;right:12px;top:-9px;background:#111;color:#fff;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:700;letter-spacing:.02em}[data-limitless-save]{font-size:12px;font-weight:600;opacity:.72}";
    root.appendChild(style);

    function choose(key) {
      selected = key;
      Array.prototype.forEach.call(root.querySelectorAll("[data-limitless-bundle]"), function (node) {
        node.setAttribute("aria-checked", node.getAttribute("data-key") === selected ? "true" : "false");
      });
      var chosen = offers.find(function (offer) { return offer.key === selected; });
      if (typeof options.onChange === "function") options.onChange(chosen);
      root.dispatchEvent(new CustomEvent("limitless:bundle-change", { detail: chosen }));
      return chosen;
    }

    offers.forEach(function (offer) {
      var card = document.createElement("button");
      card.type = "button";
      card.setAttribute("role", "radio");
      card.setAttribute("data-limitless-bundle", "");
      card.setAttribute("data-key", offer.key);
      card.setAttribute("aria-checked", offer.key === selected ? "true" : "false");
      card.innerHTML =
        (offer.badge ? '<span data-limitless-badge>' + offer.badge + '</span>' : '') +
        '<span><strong>' + offer.label + '</strong><br><small>' + offer.subtitle + '</small></span>' +
        '<span data-limitless-bundle-price>' + money(offer.totalCents) + '<small>' + money(offer.perItemCents) + ' each</small></span>' +
        (offer.savingsCents ? '<span data-limitless-save>Save ' + money(offer.savingsCents) + '</span>' : '<span></span>');
      card.addEventListener("click", function () { choose(offer.key); });
      root.appendChild(card);
    });

    return Object.freeze({
      getSelected: function () { return offers.find(function (offer) { return offer.key === selected; }); },
      select: choose,
      offers: offers.slice()
    });
  }

  global.LimitlessBundles = Object.freeze({
    version: "1.0.0",
    tiers: TIERS,
    offers: offerModel,
    render: render
  });
})(typeof window !== "undefined" ? window : globalThis);
