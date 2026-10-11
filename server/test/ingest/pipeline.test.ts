import test from "node:test";
import assert from "node:assert/strict";
import { ingestLink } from "../../src/ingest/pipeline.js";
import { MemoryStore } from "../../src/ingest/store.js";
import { validateDigest } from "../../src/ingest/digest/validate.js";

const geminiReply = (body: object) => async () =>
  new Response(JSON.stringify({ responseId: "r1", candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }));

test("ready unit keeps canonical URL and start; model URL cannot replace it", async () => {
  const store = new MemoryStore();
  const u = await ingestLink("https://www.youtube.com/watch?v=V-EDrhIhHzQ&list=WL&index=5&t=306s", {
    geminiKey: "k", store,
    fetchImpl: geminiReply({ source_url: "https://www.youtube.com/watch?v=V-EDrhIhHzQ", content_accessed: true,
      evidence_items: [{ start_seconds: 310, end_seconds: 330, observed_spoken_content: "post-training" }] }) as typeof fetch,
  });
  assert.equal(u.status, "ready");
  assert.equal(u.sourceUrl, "https://www.youtube.com/watch?v=V-EDrhIhHzQ");
  assert.equal(u.startSeconds, 306);
  assert.deepEqual(u.transcript?.window, [306, 606]);
  assert.equal((await store.listReadyUnits()).length, 1);
});

test("HTTP failure becomes a failed unit with the real error and is not usable", async () => {
  const store = new MemoryStore();
  const u = await ingestLink("https://www.youtube.com/watch?v=VQy50fuxI34", {
    geminiKey: "k", store, retries: 0,
    fetchImpl: (async () => new Response("denied", { status: 403 })) as typeof fetch,
  });
  assert.equal(u.status, "failed");
  assert.match(u.error!, /403/);
  assert.equal((await store.listReadyUnits()).length, 0);
});

test("digest validation rejects unknown ids and out-of-window evidence", async () => {
  const store = new MemoryStore();
  const u = await ingestLink("https://www.youtube.com/watch?v=VQy50fuxI34", {
    geminiKey: "k", store,
    fetchImpl: geminiReply({ source_url: "https://www.youtube.com/watch?v=VQy50fuxI34", content_accessed: true,
      evidence_items: [{ start_seconds: 22, end_seconds: 35, observed_spoken_content: "sdlc" }] }) as typeof fetch,
  });
  const art = (id: string, s = 22) => ({ name: "a", source_ids: [id], category: "c", processed_text: "t", selection_reason: "r",
    evidence: [{ source_id: id, start_seconds: s, end_seconds: s + 13, passage: "p" }] });
  assert.doesNotThrow(() => validateDigest({ artifacts: [art(u.id)], exclusions: [] }, [u]));
  assert.throws(() => validateDigest({ artifacts: [art("00000000-0000-4000-8000-000000000000")], exclusions: [] }, [u]), /unknown/);
  assert.throws(() => validateDigest({ artifacts: [art(u.id, 500)], exclusions: [] }, [u]), /outside/);
});


import { extractWithGemini } from "../../src/ingest/extract/gemini.js";
const reply = (text: string) => new Response(JSON.stringify({ responseId: "r", candidates: [{ content: { parts: [{ text }] } }] }));
const good = JSON.stringify({ source_url: "https://www.youtube.com/watch?v=VQy50fuxI34", content_accessed: true,
  evidence_items: [{ start_seconds: 5, end_seconds: 20, observed_spoken_content: "x" }] });
const opts = (fetchImpl: () => Promise<Response>, retries: number) => ({
  apiKey: "k", sourceUrl: "https://www.youtube.com/watch?v=VQy50fuxI34", window: [0, 300] as [number, number],
  fetchImpl: fetchImpl as unknown as typeof fetch, retries, retryDelayMs: 1,
});

test("a malformed JSON reply is retried and then succeeds", async () => {
  let calls = 0;
  const r = await extractWithGemini(opts(async () => reply(++calls === 1 ? '{"source_url": "x",\n  "evidence_items": [\n   {,}]}' : good), 2));
  assert.equal(calls, 2);
  assert.equal(r.extraction.content_accessed, true);
});

test("persistent malformed JSON fails with an excerpt of the bad reply", async () => {
  let calls = 0;
  const bad = '{"source_url": "https://www.youtube.com/watch?v=VQy50fuxI34",\n  "evidence_items": [\n    {"start_seconds": 1,}\n  ]}';
  await assert.rejects(extractWithGemini(opts(async () => (calls++, reply(bad)), 2)), (e: Error) => {
    assert.match(e.message, /not valid JSON/);
    assert.match(e.message, /near char \d+ of \d+/);
    assert.match(e.message, /start_seconds/);
    return true;
  });
  assert.equal(calls, 3, "initial attempt plus two retries");
});

test("a reply with the wrong shape is retried too", async () => {
  let calls = 0;
  const r = await extractWithGemini(opts(async () => reply(++calls === 1 ? JSON.stringify({ unexpected: true }) : good), 1));
  assert.equal(calls, 2);
  assert.equal(r.extraction.evidence_items.length, 1);
});
