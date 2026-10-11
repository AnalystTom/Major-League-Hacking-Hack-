import test from "node:test";
import assert from "node:assert/strict";
import { poolConfig } from "../src/db.js";
import { recordError, lastErrorSeen, redact } from "../src/activity.js";
import { reasoningEffort, effortField } from "../src/openaiEffort.js";

test("a hosted database gets TLS unless the URL picks an sslmode; a local one stays plain", () => {
  const hosted = poolConfig("postgres://u:p@kc5lnts1vn.vy2oiaal4n.tsdb.cloud.timescale.com:32440/tsdb?");
  assert.equal(hosted.ssl, true);
  assert.equal(hosted.connectionTimeoutMillis, 10_000);
  assert.equal(hosted.keepAlive, true);
  assert.equal(poolConfig("postgres://u:p@db.example.com/tsdb?sslmode=require").ssl, undefined, "the URL's own sslmode wins");
  assert.equal(poolConfig("postgres://u:p@127.0.0.1:54329/dev").ssl, undefined);
  assert.equal(poolConfig("postgres://u:p@localhost/dev").ssl, undefined);
});

test("the last processing error is kept for /health without credentials", () => {
  recordError("processing failed", new Error("connect to postgres://tsdbadmin:hunter2@db.example.com:5432/tsdb failed; password=hunter2"));
  const e = lastErrorSeen()!;
  assert.match(e.message, /^processing failed: connect to postgres:\/\/<redacted>@db\.example\.com/);
  assert.ok(!e.message.includes("hunter2"));
  assert.ok(Date.parse(e.at) > 0);
  assert.equal(redact("x".repeat(900)).length, 500);
});

test("OPENAI_REASONING_EFFORT is validated and only sent when set", () => {
  assert.equal(reasoningEffort("xhigh"), "xhigh");
  assert.equal(reasoningEffort(""), undefined);
  assert.equal(reasoningEffort(undefined), undefined);
  assert.throws(() => reasoningEffort("extra-high"), /must be one of/);
  const before = process.env.OPENAI_REASONING_EFFORT;
  delete process.env.OPENAI_REASONING_EFFORT; assert.deepEqual(effortField(), {});
  process.env.OPENAI_REASONING_EFFORT = "xhigh"; assert.deepEqual(effortField(), { reasoning_effort: "xhigh" });
  if (before === undefined) delete process.env.OPENAI_REASONING_EFFORT; else process.env.OPENAI_REASONING_EFFORT = before;
});

test("redaction removes configured secret values and quoted or JSON-style credentials", () => {
  process.env.TEST_FAKE_API_KEY = "sk-live-abcdef123456";
  const r = redact(`OpenAI said sk-live-abcdef123456 was bad; {"password":"hunter 2 two"} and token: 'abc def'`);
  delete process.env.TEST_FAKE_API_KEY;
  assert.ok(!r.includes("sk-live-abcdef123456"));
  assert.ok(!r.includes("hunter"));
  assert.ok(!r.includes("abc def"));
  assert.match(r, /"password":<redacted>/);
});

test("IPv6 loopback stays a plain local connection", () => {
  assert.equal(poolConfig("postgres://u:p@[::1]:5432/dev").ssl, undefined);
});

test("/health shows last_error only with the processor's token", async () => {
  const { createApp } = await import("../src/app.js");
  const app = createApp({ webOrigins: [], healthToken: "tok-123" });
  recordError("processing failed", new Error("boom"));
  assert.equal((await (await app.request("/health")).json()).last_error, undefined);
  const withToken = await (await app.request("/health", { headers: { authorization: "Bearer tok-123" } })).json();
  assert.match(withToken.last_error.message, /processing failed: boom/);
});
