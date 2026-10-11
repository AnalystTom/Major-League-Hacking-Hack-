import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIMITS, limitsFromEnv, remaining, resumesAt, startOfNextUtcDay, startOfNextUtcMonth } from "../../src/ingest/limits.js";
import { processUnits } from "../../src/ingest/processor.js";
import { MemoryStore } from "../../src/ingest/store.js";
import { mockFetch, pendingUnit } from "./helpers.js";

test("limits come from the env, default to 10 a day and 40 a month, and reject nonsense", () => {
  assert.deepEqual(limitsFromEnv({}), DEFAULT_LIMITS);
  assert.deepEqual(limitsFromEnv({ DAILY_VIDEO_LIMIT: "3", MONTHLY_VIDEO_LIMIT: "0" }), { daily: 3, monthly: 0 });
  assert.throws(() => limitsFromEnv({ DAILY_VIDEO_LIMIT: "-1" }), /DAILY_VIDEO_LIMIT/);
  assert.throws(() => limitsFromEnv({ MONTHLY_VIDEO_LIMIT: "ten" }), /MONTHLY_VIDEO_LIMIT/);
});

test("room left is the tighter of the two limits; held units resume tomorrow, or next month once that's used up", () => {
  const l = { daily: 10, monthly: 40 };
  assert.equal(remaining(l, { today: 4, month: 20 }), 6);
  assert.equal(remaining(l, { today: 4, month: 38 }), 2);
  assert.equal(remaining(l, { today: 12, month: 20 }), 0);
  const now = new Date("2026-10-31T22:15:00Z");
  assert.equal(startOfNextUtcDay(now).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(startOfNextUtcMonth(new Date("2026-12-05T01:00:00Z")).toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(resumesAt(l, { today: 10, month: 20 }, new Date("2026-10-11T20:00:00Z")).toISOString(), "2026-10-12T00:00:00.000Z");
  assert.equal(resumesAt(l, { today: 3, month: 40 }, new Date("2026-10-11T20:00:00Z")).toISOString(), "2026-11-01T00:00:00.000Z");
});

test("units over the daily limit stay pending, marked deferred, and nothing waits on them", async () => {
  const store = new MemoryStore();
  const units = [pendingUnit("VQy50fuxI34"), pendingUnit("V-EDrhIhHzQ"), pendingUnit("dQw4w9WgXcQ")];
  for (const u of units) await store.saveUnit(u);
  const { impl, calls } = mockFetch();
  const started = Date.now();
  const s = await processUnits(units.map((u) => u.id), { geminiKey: "k", store, fetchImpl: impl, retries: 0, limits: { daily: 1, monthly: 40 }, pollMs: 5, waitTimeoutMs: 60_000 });
  assert.equal(calls.gemini, 1, "only one unit was read");
  assert.equal(s.deferred, 2);
  assert.ok(Date.now() - started < 5000, "it didn't wait for the held units");
  const [a, b, c] = await store.getUnits(units.map((u) => u.id));
  assert.equal(a.status, "ready");
  assert.deepEqual([b.status, c.status], ["pending", "pending"]);
  assert.ok(store.deferredUntil.get(b.id)! > new Date());

  // The next day's room claims them; with the limit still used up, a repeat request reads nothing.
  const again = await processUnits([b.id, c.id], { geminiKey: "k", store, fetchImpl: impl, retries: 0, limits: { daily: 1, monthly: 40 } });
  assert.equal(again.deferred, 2);
  assert.equal(calls.gemini, 1);
  const tomorrow = await processUnits([b.id, c.id], { geminiKey: "k", store, fetchImpl: impl, retries: 0, limits: { daily: 3, monthly: 40 } });
  assert.equal(tomorrow.deferred, 0);
  assert.equal(calls.gemini, 3);
});

test("a monthly limit of 0 pauses processing entirely", async () => {
  const store = new MemoryStore();
  const u = pendingUnit("VQy50fuxI34");
  await store.saveUnit(u);
  const { impl, calls } = mockFetch();
  const s = await processUnits([u.id], { geminiKey: "k", store, fetchImpl: impl, limits: { daily: 10, monthly: 0 } });
  assert.equal(s.deferred, 1);
  assert.equal(calls.gemini, 0);
});

test("re-digesting an already-read video takes a slot; the digest its extraction paid for doesn't", async () => {
  const store = new MemoryStore();
  const u = pendingUnit("VQy50fuxI34");
  await store.saveUnit(u);
  const { impl, calls } = mockFetch();
  const limits = { daily: 1, monthly: 40 };
  const first = await processUnits([u.id], { geminiKey: "k", openaiKey: "o", store, fetchImpl: impl, retries: 0, limits });
  assert.equal(first.digested, 1, "extraction and its digest fit in one slot");
  assert.equal(calls.openai, 1);

  // Someone else's import of the same video needs a new digest (here: the first one was removed). No room left today.
  store.artifacts = [];
  const again = await processUnits([u.id], { geminiKey: "k", openaiKey: "o", store, fetchImpl: impl, retries: 0, limits });
  assert.equal(again.deferred, 1);
  assert.equal(again.skipped, "processing limit reached");
  assert.equal(calls.openai, 1, "no paid digest");
  assert.ok(store.deferredUntil.get(u.id)! > new Date());
  const tomorrow = await processUnits([u.id], { geminiKey: "k", openaiKey: "o", store, fetchImpl: impl, retries: 0, limits: { daily: 2, monthly: 40 } });
  assert.equal(tomorrow.digested, 1);
  assert.equal(store.deferredUntil.has(u.id), false);
});
