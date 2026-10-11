import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createIngestApp } from "../../src/ingest/api.js";
import { MemoryStore } from "../../src/ingest/store.js";

const auth = { authorization: "Bearer test-token" };
const ok = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
  source_url: "https://www.youtube.com/watch?v=VQy50fuxI34", content_accessed: true,
  evidence_items: [{ start_seconds: 5, end_seconds: 20, observed_spoken_content: "x" }] }) }] } }] }));

const post = (app: Hono, body: unknown) => app.request("/imports", { method: "POST", headers: auth, body: JSON.stringify(body) });
async function settle(app: Hono, id: string, done: (b: any) => boolean) {
  let body: any;
  for (let i = 0; i < 50; i++) {
    body = await (await app.request(`/imports/${id}`, { headers: auth })).json();
    if (done(body)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return body;
}
const settled = (b: any) => b.links.every((l: any) => l.status === "ready" || l.status === "failed");

test("POST /imports reports per-link state; bad link shows its error", async () => {
  const app = createIngestApp({ token: "test-token", geminiKey: "k", store: new MemoryStore(), fetchImpl: ok as typeof fetch, retries: 0 });
  const res = await post(app, { links: ["https://www.youtube.com/watch?v=VQy50fuxI34&list=WL", "https://example.com/x"], request: "group by problem" });
  assert.equal(res.status, 202);
  const body = await settle(app, (await res.json()).id, settled);
  assert.equal(body.links[0].status, "ready");
  assert.equal(body.links[0].source_url, "https://www.youtube.com/watch?v=VQy50fuxI34");
  assert.equal(body.links[1].status, "failed");
  assert.match(body.links[1].error, /YouTube/);
  assert.equal((await post(app, { links: [] })).status, 400);
  assert.equal((await app.request("/imports", { method: "POST", headers: auth, body: "{" })).status, 400);
  assert.equal((await app.request("/imports/nope", { headers: auth })).status, 404);
});

test("API returns extracted evidence and stores digested artifacts", async () => {
  const store = new MemoryStore();
  const fetchImpl = (async (url: string, init: { body: string }) => {
    if (String(url).includes("openai")) {
      const unitId = JSON.parse(JSON.parse(init.body).messages[1].content).units[0].id;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        artifacts: [{ name: "a", source_ids: [unitId], category: "c", processed_text: "t", selection_reason: "r",
          evidence: [{ source_id: unitId, start_seconds: 5, end_seconds: 20, passage: "p" }] }],
        exclusions: [] }) } }] }));
    }
    return ok();
  }) as unknown as typeof fetch;
  const app = createIngestApp({ token: "test-token", geminiKey: "k", openaiKey: "a", store, fetchImpl, retries: 0 });
  const { id } = await (await post(app, { links: ["https://www.youtube.com/watch?v=VQy50fuxI34"], request: "r" })).json();
  const body = await settle(app, id, (b) => ["ready", "failed", "skipped"].includes(b.digest.status));
  assert.equal(body.links[0].extraction.evidence_items[0].observed_spoken_content, "x");
  assert.equal("review_status" in body.links[0], false);
  assert.match(body.links[0].extraction_method, /^gemini:/);
  assert.ok(body.links[0].extracted_at);
  assert.equal(body.digest.status, "ready", body.digest.error);
  const row = body.digest.stored_artifacts[0];
  assert.equal(body.digest.stored_artifacts.length, 1);
  assert.equal(row.id, store.artifacts[0].id);
  assert.equal(row.ingestion_status, "ready");
  assert.equal(row.review_status, "pending");
  assert.equal(row.version, 1);
  assert.ok(body.digest.digestion_prompt_id);
  assert.equal(row.digestion_prompt_id, body.digest.digestion_prompt_id);
  assert.equal(store.prompts.length, 1);
  assert.match(store.prompts[0].promptText, /categorization request ---\nr$/);
  assert.equal(row.sources[0].url, "https://www.youtube.com/watch?v=VQy50fuxI34");
  assert.equal(row.source_url, "https://www.youtube.com/watch?v=VQy50fuxI34");
});

test("window_seconds is validated and applied per import", async () => {
  const app = createIngestApp({ token: "test-token", geminiKey: "k", store: new MemoryStore(), fetchImpl: ok as typeof fetch, retries: 0 });
  const send = (window_seconds: number) => post(app, { links: ["https://www.youtube.com/watch?v=VQy50fuxI34"], request: "r", window_seconds });
  assert.equal((await send(3601)).status, 400);
  assert.equal((await send(10)).status, 400);
  const res = await send(3600);
  assert.equal(res.status, 202);
  const body = await settle(app, (await res.json()).id, settled);
  assert.deepEqual(body.links[0].extraction.window, [0, 3600]);
});

test("ingestion requires authentication before accepting work or reading jobs", async () => {
  let calls = 0;
  const app = createIngestApp({ token: "test-token", geminiKey: "k", store: new MemoryStore(),
    fetchImpl: (async () => { calls++; return ok(); }) as typeof fetch });
  const body = JSON.stringify({ links: ["https://youtu.be/VQy50fuxI34"], request: "r" });
  assert.equal((await app.request("/imports", { method: "POST", body })).status, 401);
  assert.equal((await app.request("/imports", { method: "POST", body, headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await app.request("/imports/nope")).status, 401);
  const mounted = new Hono().route("/api/ingest", app);
  assert.equal((await mounted.request("/api/ingest/imports", { method: "POST", body })).status, 401);
  assert.equal((await mounted.request("/api/ingest/imports/nope")).status, 401);
  assert.equal(calls, 0);
  assert.equal((await post(app, null)).status, 400);
});

test("storage failure becomes a failed link instead of an unhandled job rejection", async () => {
  const store = new MemoryStore();
  store.saveUnit = async () => { throw new Error("database unavailable"); };
  const app = createIngestApp({ token: "test-token", geminiKey: "k", store, fetchImpl: ok as typeof fetch });
  const { id } = await (await post(app, { links: ["https://youtu.be/VQy50fuxI34"], request: "r" })).json();
  const body = await settle(app, id, settled);
  assert.equal(body.links[0].status, "failed");
  assert.equal(body.links[0].error, "database unavailable");
});

test("failed artifact storage is not reported as a ready digest", async () => {
  const store = new MemoryStore();
  store.saveArtifacts = async () => { throw new Error("artifact write failed"); };
  const app = createIngestApp({ token: "test-token", geminiKey: "k", openaiKey: "a", store,
    fetchImpl: (async (url) => String(url).includes("openai")
      ? Response.json({ choices: [{ message: { content: JSON.stringify({ artifacts: [], exclusions: [] }) } }] })
      : ok()) as typeof fetch });
  const { id } = await (await post(app, { links: ["https://youtu.be/VQy50fuxI34"], request: "r" })).json();
  const body = await settle(app, id, (b) => ["ready", "failed"].includes(b.digest.status));
  assert.equal(body.digest.status, "failed");
  assert.equal(body.digest.error, "artifact write failed");
  assert.equal(body.digest.stored_artifacts, null);
});
