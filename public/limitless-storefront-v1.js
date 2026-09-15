(function (global) {
  "use strict";

  var DEFAULT_CHECKOUT_ORIGIN = "https://limitlesscheckout.netlify.app";
  var BRAND_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var NUMERIC_VARIANT = /^\d+$/;
  var GID_VARIANT = /^gid:\/\/shopify\/ProductVariant\/(\d+)$/;
  var PERSONALIZATION_REF = /^pers_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var PERSONALIZATION_PROOF = /^[A-Za-z0-9_-]{40,100}$/;

  function error(message) {
    throw new Error("Limitless Checkout: " + message);
  }

  function canonicalVariant(value) {
    var id = String(value == null ? "" : value).trim();
    var gid = GID_VARIANT.exec(id);
    if (gid) return { value: id, key: gid[1] };
    if (NUMERIC_VARIANT.test(id)) return { value: id, key: id };
    error("each cart item needs a Shopify variant ID");
  }

  function normalizeItems(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
      error("cart must contain between 1 and 30 lines");
    }

    var seenVariants = Object.create(null);
    var seenPersonalizations = Object.create(null);

    return items.map(function (item) {
      if (!item || typeof item !== "object" || Array.isArray(item)) error("cart lines must be objects");
      var variant = canonicalVariant(item.variantId != null ? item.variantId : item.shopifyVariantId);
      var quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) error("quantity must be a whole number from 1 to 20");

      var ref = item.personalizationRef == null ? "" : String(item.personalizationRef).trim();
      var proof = item.personalizationProof == null ? "" : String(item.personalizationProof).trim();
      if ((ref && !proof) || (!ref && proof)) error("personalization reference and proof must be provided together");
      if (ref && !PERSONALIZATION_REF.test(ref)) error("personalization reference is invalid");
      if (proof && !PERSONALIZATION_PROOF.test(proof)) error("personalization proof is invalid");
      if (ref && seenPersonalizations[ref]) error("the same personalization reference cannot appear twice");

      var prior = seenVariants[variant.key];
      if (prior) {
        var personalizedDuplicate = prior.personalized && ref && prior.quantity === 1 && quantity === 1;
        if (!personalizedDuplicate) error("the same Shopify variant cannot appear twice unless each line has its own personalization");
      }

      if (ref) seenPersonalizations[ref] = true;
      if (!prior) seenVariants[variant.key] = { personalized: !!ref, quantity: quantity };

      return {
        variantId: variant.value,
        quantity: quantity,
        ...(ref ? { personalizationRef: ref, personalizationProof: proof } : {})
      };
    });
  }

  function checkoutOrigin(value) {
    var raw = value || DEFAULT_CHECKOUT_ORIGIN;
    var url;
    try { url = new URL(raw); } catch (_) { error("checkout origin is invalid"); }
    var local = (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.protocol === "http:";
    if (url.protocol !== "https:" && !local) error("checkout origin must use HTTPS");
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) error("checkout origin must be an origin only");
    return url.origin;
  }

  function payload(items) {
    return JSON.stringify({ items: normalizeItems(items) });
  }

  function start(options) {
    options = options || {};
    var brandSlug = String(options.brandSlug || "").trim();
    if (!BRAND_PATTERN.test(brandSlug) || brandSlug.length > 200) error("brandSlug is invalid");
    if (!global.document || !global.document.body || typeof global.document.createElement !== "function") error("browser document is unavailable");

    var form = global.document.createElement("form");
    form.method = "POST";
    form.action = checkoutOrigin(options.checkoutOrigin) + "/cart/start/" + encodeURIComponent(brandSlug);
    form.style.display = "none";

    var input = global.document.createElement("input");
    input.type = "hidden";
    input.name = "cart";
    input.value = payload(options.items);
    form.appendChild(input);
    global.document.body.appendChild(form);
    form.submit();
  }

  global.LimitlessCheckout = Object.freeze({
    version: "1.2.0",
    normalizeItems: normalizeItems,
    payload: payload,
    start: start
  });
})(typeof window !== "undefined" ? window : globalThis);
