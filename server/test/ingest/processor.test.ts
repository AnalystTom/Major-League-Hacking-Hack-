import test from "node:test";
import assert from "node:assert/strict";
import { processUnits, sweepOnce } from "../../src/ingest/processor.js";
import { createIngestApp } from "../../src/ingest/api.js";
import { MemoryStore } from "../../src/ingest/store.js";
import { mockFetch, pendingUnit } from "./helpers.js";
import { DEFAULT_CATEGORIZATION_REQUEST, promptRevisionText } from "../../src/ingest/digest/prompt.js";

const base = (store: MemoryStore, fetchImpl: typeof fetch) =>
  ({ geminiKey: "k", openaiKey: "o", store, fetchImpl, retries: 0, pollMs: 1, waitTimeoutMs: 500 });

test("extracts a pending unit from its stored URL/start, fetches the title, and digests it generically", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("V-EDrhIhHzQ", 306);
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  const summary = await processUnits([unit.id], base(store, impl));

  const saved = (await store.getUnits([unit.id]))[0];
  assert.equal(saved.status, "ready");
  assert.equal(saved.title, "Real Title");
  assert.deepEqual(saved.transcript?.window, [306, 3906]);
  assert.equal(saved.submittedUrl, unit.submittedUrl, "submitted URL is preserved");
  assert.equal(summary.digested, 1);
  assert.equal(store.artifacts[0].project_context_id, null);
  assert.equal(store.artifacts[0].project_context_version, null);
  assert.equal(calls.gemini, 1);
  assert.equal("project_context" in (calls.lastDigestRequest as object), false, "no project is sent to the model");
});

test("a unit that already has a digest is skipped on a repeat request", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  await processUnits([unit.id], base(store, impl));
  const again = await processUnits([unit.id], base(store, impl));
  assert.equal(again.digested, 0);
  assert.match(again.skipped ?? "", /nothing new/);
  assert.equal(store.artifacts.length, 1);
  assert.deepEqual([calls.gemini, calls.openai], [1, 1]);
});

test("a unit the digest excluded is not sent to the model again", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  await processUnits([unit.id], { ...base(store, impl), openaiKey: undefined });
  const promptId = await store.registerPrompt(promptRevisionText(DEFAULT_CATEGORIZATION_REQUEST), []);
  await store.saveArtifacts([], [{ unit_id: unit.id, reason: "Nothing to explain." }], promptId);
  const s = await processUnits([unit.id], base(store, impl));
  assert.match(s.skipped ?? "", /nothing new/);
  assert.equal(calls.openai, 0);
});

test("requests and sweeps reconsider exclusions from an older prompt without re-extracting", async () => {
  for (const sweep of [false, true]) {
    const store = new MemoryStore();
    const unit = pendingUnit("VQy50fuxI34");
    await store.saveUnit(unit);
    store.imported.add(unit.id);
    const { impl, calls } = mockFetch();
    await processUnits([unit.id], { ...base(store, impl), openaiKey: undefined });
    const oldPrompt = await store.registerPrompt("Engineering only", []);
    await store.saveArtifacts([], [{ unit_id: unit.id, reason: "Off topic." }], oldPrompt);
    if (sweep) assert.equal(await sweepOnce(base(store, impl)), 1);
    else assert.equal((await processUnits([unit.id], base(store, impl))).digested, 1);
    assert.equal(calls.gemini, 1);
    assert.equal(calls.openai, 1);
    assert.deepEqual(store.artifacts[0].source_ids, [unit.id]);
    assert.equal(await sweepOnce(base(store, impl)), 0);
  }
});

test("duplicate concurrent requests extract and digest once", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  await Promise.all([processUnits([unit.id], base(store, impl)), processUnits([unit.id], base(store, impl))]);
  assert.equal(calls.gemini, 1);
  assert.equal(calls.openai, 1);
  assert.equal(store.artifacts.length, 1);
});

test("a failed extraction keeps its error and does not block siblings", async () => {
  const store = new MemoryStore();
  const bad = pendingUnit("AAAAAAAAAAA"), good = pendingUnit("VQy50fuxI34");
  await store.saveUnit(bad); await store.saveUnit(good);
  const { impl } = mockFetch({ failVideo: "AAAAAAAAAAA" });
  const s = await processUnits([bad.id, good.id], base(store, impl));
  assert.deepEqual(s.extracted, { ready: 1, failed: 1 });
  const [b] = await store.getUnits([bad.id]);
  assert.equal(b.status, "failed");
  assert.match(b.error!, /403/);
  assert.deepEqual(store.artifacts[0].source_ids, [good.id]);
});

test("a title lookup failure leaves the title null and the unit ready", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  await processUnits([unit.id], base(store, mockFetch({ title: null }).impl));
  const [u] = await store.getUnits([unit.id]);
  assert.equal(u.status, "ready");
  assert.equal(u.title, null);
});

test("a digest failure is recorded per unit and a later request retries it", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  let status = 500;
  const { impl } = mockFetch({ digestStatus: () => status });
  await processUnits([unit.id], base(store, impl));
  assert.equal(store.artifacts.length, 1);
  assert.equal(store.artifacts[0].ingestion_status, "failed");
  assert.match(store.artifacts[0].error!, /500/);

  status = 200;
  const retry = await processUnits([unit.id], base(store, impl));
  assert.equal(retry.digested, 1);
  assert.deepEqual(store.artifacts.map((a) => a.ingestion_status), ["failed", "ready"]);
});

test("waits for a unit another worker is extracting, then digests it", async () => {
  const store = new MemoryStore();
  const unit = { ...pendingUnit("VQy50fuxI34"), status: "running" as const };
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  setTimeout(() => void store.saveUnit({ ...unit, status: "ready", transcript: { window: [0, 300], evidence_items: [{ start_seconds: 5, end_seconds: 20, observed_spoken_content: "x" }] } }), 20);
  const s = await processUnits([unit.id], base(store, impl));
  assert.equal(s.waitedFor, 1);
  assert.equal(s.digested, 1);
  assert.equal(calls.gemini, 0);
});

test("without an OpenAI key units are extracted but not digested", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  const s = await processUnits([unit.id], { ...base(store, impl), openaiKey: undefined });
  assert.match(s.skipped!, /OPENAI_API_KEY/);
  assert.equal((await store.getUnits([unit.id]))[0].status, "ready");
  assert.equal(calls.openai, 0);
  assert.equal(store.artifacts.length, 0);
});

test("sweep processes imported pending units and leaves unimported ones", async () => {
  const store = new MemoryStore();
  const imported = pendingUnit("VQy50fuxI34"), orphan = pendingUnit("V-EDrhIhHzQ");
  await store.saveUnit(imported); await store.saveUnit(orphan);
  store.imported.add(imported.id);
  const { impl } = mockFetch();
  assert.equal(await sweepOnce(base(store, impl)), 1);
  assert.equal((await store.getUnits([imported.id]))[0].status, "ready");
  assert.equal((await store.getUnits([orphan.id]))[0].status, "pending");
  assert.equal(store.artifacts.length, 1);
});

test("POST /process requires the bearer token, validates the body, and returns 202", async (t) => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  const app = createIngestApp({ ...base(store, impl), token: "secret" });
  const send = (headers: Record<string, string>, body: unknown) => app.request("/process", { method: "POST", headers, body: JSON.stringify(body) });
  const good = { unit_ids: [unit.id] };

  assert.equal((await send({}, good)).status, 401);
  assert.equal((await send({ authorization: "Bearer wrong" }, good)).status, 401);
  assert.equal((await app.request("/imports/x")).status, 401, "every ingest route is protected");
  const auth = { authorization: "Bearer secret" };
  assert.equal((await send(auth, { unit_ids: ["nope"] })).status, 400);
  assert.equal((await send(auth, { unit_ids: [] })).status, 400);

  // An older caller that still sends `project` is accepted; the key is ignored.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const claim = store.claimWithinLimits.bind(store);
  t.mock.method(store, "claimWithinLimits", async (...args: Parameters<typeof claim>) => {
    await gate;
    return claim(...args);
  });
  try {
    const res = await send(auth, { ...good, project: null });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { accepted: 1 });
    assert.equal(store.prompts.length, 1);
    assert.equal(calls.openai, 0);
  } finally { release(); }
  for (let i = 0; i < 100 && store.artifacts.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.artifacts[0].project_context_id, null);
});

test("createIngestApp refuses to start without a token", () => {
  assert.throws(() => createIngestApp({ ...base(new MemoryStore(), fetch), token: "" }));
});
