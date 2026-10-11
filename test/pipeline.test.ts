import test from "node:test";
import assert from "node:assert/strict";
import { ingestLink } from "../src/pipeline.ts";
import { MemoryStore } from "../src/store.ts";
import { validateDigest } from "../src/digest/validate.ts";

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
