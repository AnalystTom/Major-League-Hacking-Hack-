import test from "node:test";
import assert from "node:assert/strict";
import { D1Database, databaseFromEnv } from "../src/db.js";
import { recordError, lastErrorSeen, redact } from "../src/activity.js";
import { reasoningEffort, effortField } from "../src/openaiEffort.js";

test("D1 requires a complete URL/token pair and HTTPS outside local development", () => {
  assert.equal(databaseFromEnv({}),null);
  assert.throws(()=>databaseFromEnv({D1_URL:'https://processor.example/internal/d1'}),/both/);
  assert.throws(()=>new D1Database('http://processor.example/internal/d1','token'),/HTTPS/);
  assert.throws(()=>new D1Database('https://processor.example/internal/d1',''),/required/);
  assert.ok(new D1Database('http://localhost:8787/internal/d1','token'));
});

test("the last processing error is kept for /health without credentials", () => {
  recordError("processing failed", new Error("connect to postgres://tsdbadmin:hunter2@db.example.com:5432/tsdb failed; password=hunter2"));
  const e = lastErrorSeen()!;
  assert.match(e.message, /^processing failed: connect to postgres:\/\/<redacted>@db\.example\.com/);
  assert.ok(!e.message.includes("hunter2"));
  assert.ok(Date.parse(e.at) > 0);
  assert.equal(redact("x".repeat(900)).length, 500);
});

test("NICRRON_REASONING_EFFORT is validated and only sent when set", () => {
  assert.equal(reasoningEffort("xhigh"), "xhigh");
  assert.equal(reasoningEffort(""), undefined);
  assert.equal(reasoningEffort(undefined), undefined);
  assert.throws(() => reasoningEffort("extra-high"), /must be one of/);
  const before = process.env.NICRRON_REASONING_EFFORT;
  delete process.env.NICRRON_REASONING_EFFORT; assert.deepEqual(effortField(), {});
  process.env.NICRRON_REASONING_EFFORT = "xhigh"; assert.deepEqual(effortField(), { reasoning_effort: "xhigh" });
  if (before === undefined) delete process.env.NICRRON_REASONING_EFFORT; else process.env.NICRRON_REASONING_EFFORT = before;
});

test("redaction removes configured secret values and quoted or JSON-style credentials", () => {
  process.env.TEST_FAKE_API_KEY = "sk-live-abcdef123456";
  const r = redact(`Nicrron said sk-live-abcdef123456 was bad; {"password":"hunter 2 two"} and token: 'abc def'`);
  delete process.env.TEST_FAKE_API_KEY;
  assert.ok(!r.includes("sk-live-abcdef123456"));
  assert.ok(!r.includes("hunter"));
  assert.ok(!r.includes("abc def"));
  assert.match(r, /"password":<redacted>/);
});


test("/health shows last_error only with the processor's token", async () => {
  const { createApp } = await import("../src/app.js");
  const app = createApp({ webOrigins: [], healthToken: "tok-123" });
  recordError("processing failed", new Error("boom"));
  assert.equal((await (await app.request("/health")).json()).last_error, undefined);
  const withToken = await (await app.request("/health", { headers: { authorization: "Bearer tok-123" } })).json();
  assert.match(withToken.last_error.message, /processing failed: boom/);
});
