import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, parseOrigins } from "../src/app.ts";
import { constantTimeEqual } from "../src/constantTime.ts";
import { readBodyText } from "../src/body.ts";
import { createIngestApp } from "../src/ingest/api.js";
import { MemoryStore } from "../src/ingest/store.js";
import { createHandoffApp } from "../src/outputs/handoff-api.js";
import type { HandoffStore } from "../src/outputs/handoff-store.js";

const SITE = "https://resurface.thomasmann2001.workers.dev";

test("production allows only the deployed site by default, never localhost", () => {
  assert.deepEqual(parseOrigins(undefined), [SITE]);
  assert.deepEqual(parseOrigins(` ${SITE} , https://staging.example `), [SITE, "https://staging.example"]);
});

test("CORS echoes the deployed site and not localhost", async () => {
  const app = createApp({ webOrigins: parseOrigins(undefined) });
  const preflight = (origin: string) => app.request("/api/agents", {
    method: "OPTIONS",
    headers: { origin, "access-control-request-method": "GET" },
  });
  assert.equal((await preflight(SITE)).headers.get("access-control-allow-origin"), SITE);
  assert.equal((await preflight("http://localhost:8787")).headers.get("access-control-allow-origin"), null);
  assert.equal((await preflight("http://127.0.0.1:8787")).headers.get("access-control-allow-origin"), null);
});

test("health reports last_error only for the exact bearer token", async () => {
  const app = createApp({ webOrigins: [], healthToken: "processor-secret" });
  const reportsError = async (authorization?: string) => {
    const res = await app.request("/health", authorization === undefined ? {} : { headers: { authorization } });
    assert.equal(res.status, 200);
    return "last_error" in (await res.json());
  };
  assert.equal(await reportsError("Bearer processor-secret"), true);
  assert.equal(await reportsError("Bearer processor-secreT"), false, "same length, one byte different");
  assert.equal(await reportsError("Bearer processor-secret-and-more"), false, "longer than the token");
  assert.equal(await reportsError("Bearer processor"), false, "a prefix of the token");
  assert.equal(await reportsError("processor-secret"), false, "the bare token without the Bearer scheme");
  assert.equal(await reportsError("Bearer "), false);
  assert.equal(await reportsError(undefined), false);
});

test("health never reports last_error when no processor token is configured", async () => {
  const app = createApp({ webOrigins: [] });
  const res = await app.request("/health", { headers: { authorization: "Bearer " } });
  assert.deepEqual(await res.json(), { ok: true, busy: 0 });
});

test("constantTimeEqual compares whole strings", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
  assert.equal(constantTimeEqual("abcd", "abc"), false);
  assert.equal(constantTimeEqual("", ""), true);
  assert.equal(constantTimeEqual("", "x"), false);
  assert.equal(constantTimeEqual("café", "café"), true);
  assert.equal(constantTimeEqual("café", "cafe"), false);
});

test("readBodyText returns bodies within the limit and refuses the rest", async () => {
  const chunks = ["{\"a\":", "1}"];
  const streamed = new ReadableStream({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(next));
    },
  });
  assert.equal(await readBodyText(new Request("http://x/", { method: "POST", body: streamed, duplex: "half" } as RequestInit), 100), "{\"a\":1}");
  assert.equal(await readBodyText(new Request("http://x/", { method: "POST", body: "x".repeat(50) }), 10), null);
  assert.equal(await readBodyText(new Request("http://x/", { method: "POST" }), 10), "");
});

test("the processor refuses an oversize body before parsing or processing it", async () => {
  const app = createIngestApp({
    token: "test-token",
    geminiKey: "k",
    store: new MemoryStore(),
    fetchImpl: (() => { throw new Error("no provider call may happen"); }) as typeof fetch,
    retries: 0,
  });
  const headers = { authorization: "Bearer test-token", "content-type": "application/json" };
  const declared = await app.request("/process", {
    method: "POST",
    headers: { ...headers, "content-length": "200000" },
    body: JSON.stringify({ unit_ids: [] }),
  });
  assert.equal(declared.status, 413);
  const streamed = await app.request("/process", {
    method: "POST",
    headers,
    body: "{".padEnd(150_000, " "),
  });
  assert.equal(streamed.status, 413);
});

test("the handoff endpoint refuses an oversize body before reading the brief", async () => {
  const store = { claim: () => { throw new Error("the body must not be read into a claim"); } } as unknown as HandoffStore;
  const app = createHandoffApp({ token: "test-token", store });
  const res = await app.request("/", {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json", "content-length": "5000" },
    body: JSON.stringify({ brief_id: "00000000-0000-4000-8000-000000000000", padding: "x".repeat(4900) }),
  });
  assert.equal(res.status, 413);
});
