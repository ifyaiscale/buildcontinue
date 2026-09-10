import test from "node:test";
import assert from "node:assert/strict";
import { dashboardFetch, isEmbeddedWorkspace } from "../lib/client-api";

test("dashboard client shares concurrent challenges and refreshes them for later sessions", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://private-preview.example" } } });
  let challenges = 0; const calls: Headers[] = [];
  globalThis.fetch = async (path, options) => {
    assert.equal(options?.credentials, "same-origin"); assert.equal(options?.redirect, "error");
    if (path === "/api/auth/csrf") { challenges++; assert.equal(options?.cache, "no-store"); return Response.json({ token: `synthetic-proof-${challenges}` }); }
    calls.push(new Headers(options?.headers)); return Response.json({ ok: true });
  };
  try {
    await Promise.all([dashboardFetch("/api/brands", { method: "POST" }), dashboardFetch("/api/auth/logout", { method: "POST" })]);
    assert.equal(challenges, 1);
    for (const headers of calls) {
      assert.equal(headers.get("x-limitless-csrf"), "synthetic-proof-1");
      assert.equal(headers.get("x-limitless-origin"), "https://private-preview.example");
    }
    await dashboardFetch("/api/auth/login", { method: "POST" });
    assert.equal(challenges, 2); assert.equal(calls[2].get("x-limitless-csrf"), "synthetic-proof-2");
    await dashboardFetch("/api/state"); assert.equal(challenges, 2);
    await assert.rejects(dashboardFetch("https://external.example/api/brands", { method: "POST" }));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("dashboard client supports ordinary deployments and does not submit mutations when a challenge fails", async () => {
  const originalFetch = globalThis.fetch;
  let mutations = 0;
  try {
    globalThis.fetch = async (path, options) => {
      if (path === "/api/auth/csrf") return Response.json({ token: null });
      mutations++; assert.equal(new Headers(options?.headers).has("x-limitless-csrf"), false);
      return Response.json({ ok: true });
    };
    await dashboardFetch("/api/auth/login", { method: "POST" }); assert.equal(mutations, 1);
    globalThis.fetch = async () => Response.json({ error: "Unavailable" }, { status: 503 });
    await assert.rejects(dashboardFetch("/api/auth/login", { method: "POST" }), /prepare secure access/);
    assert.equal(mutations, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("embedded private login never sends a password, while standalone login and demo mutations remain available", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const frame = { top: {}, self: {} };
  Object.defineProperty(globalThis, "window", { configurable: true, value: frame });
  const calls: string[] = [];
  globalThis.fetch = async path => { calls.push(String(path)); return Response.json(path === "/api/auth/csrf" ? { token: null } : { ok: true }); };
  try {
    assert.equal(isEmbeddedWorkspace(), true);
    await assert.rejects(dashboardFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "synthetic-only" }) }), /own tab/);
    assert.equal(calls.length, 0);
    await dashboardFetch("/api/brands", { method: "POST" });
    assert.deepEqual(calls, ["/api/auth/csrf", "/api/brands"]);
    frame.top = frame.self;
    assert.equal(isEmbeddedWorkspace(), false);
    await dashboardFetch("/api/auth/login", { method: "POST" });
    assert.equal(calls.at(-1), "/api/auth/login");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});
