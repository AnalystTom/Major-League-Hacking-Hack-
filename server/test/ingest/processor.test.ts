import test from "node:test";
import assert from "node:assert/strict";
import { processUnits, sweepOnce } from "../../src/ingest/processor.js";
import { createIngestApp } from "../../src/ingest/api.js";
import { MemoryStore } from "../../src/ingest/store.js";
import { PROJECT_A, PROJECT_B, mockFetch, pendingUnit } from "./helpers.js";

const base = (store: MemoryStore, fetchImpl: typeof fetch) =>
  ({ geminiKey: "k", openaiKey: "o", store, fetchImpl, retries: 0, pollMs: 1, waitTimeoutMs: 500 });

test("extracts a pending unit from its stored URL/start, fetches the title, digests for the project", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("V-EDrhIhHzQ", 306);
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  const summary = await processUnits([unit.id], PROJECT_A, base(store, impl));

  const saved = (await store.getUnits([unit.id]))[0];
  assert.equal(saved.status, "ready");
  assert.equal(saved.title, "Real Title");
  assert.deepEqual(saved.transcript?.window, [306, 606]);
  assert.equal(saved.submittedUrl, unit.submittedUrl, "submitted URL is preserved");
  assert.equal(summary.digested, 1);
  assert.equal(store.artifacts[0].project_context_id, PROJECT_A.id);
  assert.equal(store.artifacts[0].project_context_version, 1);
  assert.equal(calls.gemini, 1);
});

test("a unit already digested for the project is skipped on a repeat request", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  await processUnits([unit.id], PROJECT_A, base(store, impl));
  const again = await processUnits([unit.id], PROJECT_A, base(store, impl));
  assert.equal(again.digested, 0);
  assert.match(again.skipped ?? "", /nothing new/);
  assert.equal(store.artifacts.length, 1);
  assert.deepEqual([calls.gemini, calls.openai], [1, 1]);
});

test("a ready unit is digested for a second project without re-extracting", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  await processUnits([unit.id], PROJECT_A, base(store, impl));
  const second = await processUnits([unit.id], PROJECT_B, base(store, impl));
  assert.equal(second.digested, 1);
  assert.equal(calls.gemini, 1, "extraction is shared");
  assert.deepEqual(store.artifacts.map((a) => a.project_context_id).sort(), [PROJECT_A.id, PROJECT_B.id].sort());
  // a new version of the same project is digested again
  await processUnits([unit.id], { ...PROJECT_A, version: 2 }, base(store, impl));
  assert.equal(store.artifacts.length, 3);
});

test("duplicate concurrent requests extract and digest once", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  await Promise.all([processUnits([unit.id], PROJECT_A, base(store, impl)), processUnits([unit.id], PROJECT_A, base(store, impl))]);
  assert.equal(calls.gemini, 1);
  assert.equal(calls.openai, 1);
  assert.equal(store.artifacts.length, 1);
});

test("a failed extraction keeps its error and does not block siblings", async () => {
  const store = new MemoryStore();
  const bad = pendingUnit("AAAAAAAAAAA"), good = pendingUnit("VQy50fuxI34");
  await store.saveUnit(bad); await store.saveUnit(good);
  const { impl } = mockFetch({ failVideo: "AAAAAAAAAAA" });
  const s = await processUnits([bad.id, good.id], PROJECT_A, base(store, impl));
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
  await processUnits([unit.id], null, base(store, mockFetch({ title: null }).impl));
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
  await processUnits([unit.id], PROJECT_A, base(store, impl));
  assert.equal(store.artifacts.length, 1);
  assert.equal(store.artifacts[0].ingestion_status, "failed");
  assert.match(store.artifacts[0].error!, /500/);

  status = 200;
  const retry = await processUnits([unit.id], PROJECT_A, base(store, impl));
  assert.equal(retry.digested, 1);
  assert.deepEqual(store.artifacts.map((a) => a.ingestion_status), ["failed", "ready"]);
});

test("waits for a unit another worker is extracting, then digests it for this project", async () => {
  const store = new MemoryStore();
  const unit = { ...pendingUnit("VQy50fuxI34"), status: "running" as const };
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  setTimeout(() => void store.saveUnit({ ...unit, status: "ready", transcript: { window: [0, 300], evidence_items: [{ start_seconds: 5, end_seconds: 20, observed_spoken_content: "x" }] } }), 20);
  const s = await processUnits([unit.id], PROJECT_B, base(store, impl));
  assert.equal(s.waitedFor, 1);
  assert.equal(s.digested, 1);
  assert.equal(calls.gemini, 0);
});

test("without a project units are only extracted; without an OpenAI key digestion is skipped", async () => {
  const store = new MemoryStore();
  const a = pendingUnit("VQy50fuxI34"), b = pendingUnit("V-EDrhIhHzQ");
  await store.saveUnit(a); await store.saveUnit(b);
  const { impl, calls } = mockFetch();
  const noProject = await processUnits([a.id], null, base(store, impl));
  assert.match(noProject.skipped!, /no project/);
  const noKey = await processUnits([b.id], PROJECT_A, { ...base(store, impl), openaiKey: undefined });
  assert.match(noKey.skipped!, /OPENAI_API_KEY/);
  assert.equal(calls.openai, 0);
  assert.equal(store.artifacts.length, 0);
});

test("sweep processes imported pending units with their project and leaves unimported ones", async () => {
  const store = new MemoryStore();
  const imported = pendingUnit("VQy50fuxI34"), orphan = pendingUnit("V-EDrhIhHzQ");
  await store.saveUnit(imported); await store.saveUnit(orphan);
  store.unitProjects.set(imported.id, PROJECT_A);
  const { impl } = mockFetch();
  assert.equal(await sweepOnce(base(store, impl)), 1);
  assert.equal((await store.getUnits([imported.id]))[0].status, "ready");
  assert.equal((await store.getUnits([orphan.id]))[0].status, "pending");
  assert.equal(store.artifacts[0].project_context_id, PROJECT_A.id);
});

test("POST /process requires the bearer token, validates the body, and returns 202", async () => {
  const store = new MemoryStore();
  const unit = pendingUnit("VQy50fuxI34");
  await store.saveUnit(unit);
  const { impl } = mockFetch();
  const app = createIngestApp({ ...base(store, impl), token: "secret", context: { ...PROJECT_A, id: null, version: null } });
  const send = (headers: Record<string, string>, body: unknown) => app.request("/process", { method: "POST", headers, body: JSON.stringify(body) });
  const good = { unit_ids: [unit.id], project: PROJECT_A };

  assert.equal((await send({}, good)).status, 401);
  assert.equal((await send({ authorization: "Bearer wrong" }, good)).status, 401);
  assert.equal((await app.request("/imports/x")).status, 401, "every ingest route is protected");
  const auth = { authorization: "Bearer secret" };
  assert.equal((await send(auth, { unit_ids: ["nope"], project: null })).status, 400);
  assert.equal((await send(auth, { unit_ids: [unit.id], project: { ...PROJECT_A, id: null } })).status, 400);

  const res = await send(auth, good);
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { accepted: 1 });
  for (let i = 0; i < 100 && store.artifacts.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.artifacts[0].project_context_id, PROJECT_A.id);
});

test("createIngestApp refuses to start without a token", () => {
  assert.throws(() => createIngestApp({ ...base(new MemoryStore(), fetch), token: "", context: PROJECT_A }));
});
