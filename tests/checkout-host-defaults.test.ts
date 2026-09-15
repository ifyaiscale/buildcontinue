import test from "node:test";
import assert from "node:assert/strict";
import { requestSite } from "../lib/server/hosts";

const previous = {
  NODE_ENV: process.env.NODE_ENV,
  APP_URL: process.env.APP_URL,
  CHECKOUT_ORIGINS: process.env.CHECKOUT_ORIGINS,
};

function restore() {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("production branded checkout hosts remain configured when CHECKOUT_ORIGINS is absent", () => {
  try {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://limitlesscheckout.netlify.app";
    delete process.env.CHECKOUT_ORIGINS;

    assert.deepEqual(requestSite(new Request("https://checkout.chefings.com/cart/start/chefings")), {
      kind: "checkout",
      origin: "https://checkout.chefings.com",
      slug: "chefings",
    });
    assert.deepEqual(requestSite(new Request("https://checkout.cozyinfants.com/checkout/cozyinfants")), {
      kind: "checkout",
      origin: "https://checkout.cozyinfants.com",
      slug: "cozyinfants",
    });
    assert.deepEqual(requestSite(new Request("https://checkout.facejamas.com/checkout/facejamas")), {
      kind: "checkout",
      origin: "https://checkout.facejamas.com",
      slug: "facejamas",
    });
    assert.throws(() => requestSite(new Request("https://unknown.example/")), /Site not configured/);
  } finally {
    restore();
  }
});
