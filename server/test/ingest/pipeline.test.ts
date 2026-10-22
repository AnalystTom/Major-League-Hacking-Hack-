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
  assert.deepEqual(u.transcript?.window, [306, 3906]);
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
  assert.throws(() => validateDigest({ artifacts: [art("00000000-0000-4000-8000-000000000000")], exclusions: [] }, [u]), /not one of the supplied units/);
  assert.throws(() => validateDigest({ artifacts: [art(u.id, 5000)], exclusions: [] }, [u]), /outside/);
  assert.throws(() => validateDigest({ artifacts: [art(u.id, 200)], exclusions: [] }, [u]), /cites 200-213s .* where nothing was extracted/);
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

import { runDigestion } from "../../src/ingest/digest/run.js";
const unit = { id: "11111111-1111-4111-8111-111111111111", submittedUrl: "u", sourceUrl: "https://www.youtube.com/watch?v=VQy50fuxI34", startSeconds: null,
  title: null, transcript: { window: [0, 300] as [number, number], evidence_items: [{ start_seconds: 5, end_seconds: 20, observed_spoken_content: "x" }] },
  extractionMethod: null, extractedAt: null, status: "ready" as const, error: null };
const openai = (choice: object, usage: object = {}) => (async () => Response.json({ choices: [choice], usage })) as unknown as typeof fetch;
const digest = (fetchImpl: typeof fetch, maxOutputTokens?: number) => runDigestion({ apiKey: "k", units: [unit], request: "r", fetchImpl, maxOutputTokens });

test("an empty digest reply explains itself: finish reason and token usage", async () => {
  await assert.rejects(digest(openai({ message: { content: "" }, finish_reason: "length" }, { completion_tokens: 20000, completion_tokens_details: { reasoning_tokens: 20000 } })),
    /hit the 20000-token output cap.*finish_reason: length; completion tokens 20000 of 20000 \(20000 reasoning\).*OPENAI_MAX_OUTPUT_TOKENS/);
  await assert.rejects(digest(openai({ message: { content: null }, finish_reason: "stop" }, { completion_tokens: 3 })),
    /no content \(finish_reason: stop; completion tokens 3 of 20000\)/);
  await assert.rejects(digest(openai({ message: { content: null, refusal: "I can't help with that" }, finish_reason: "stop" })), /refused: I can't help/);
});

test("the output cap is configurable and sent to OpenAI", async () => {
  let sent = 0;
  const f = (async (_u: string, init: { body: string }) => { sent = JSON.parse(init.body).max_completion_tokens; return Response.json({ choices: [{ message: { content: '{"artifacts":[],"exclusions":[]}' }, finish_reason: "stop" }] }); }) as unknown as typeof fetch;
  await digest(f, 30000);
  assert.equal(sent, 30000);
  await digest(f);
  assert.equal(sent, 20000);
});

const ready = (n: number) => ({ ...unit, id: `${n}`.padStart(8, "0") + "-1111-4111-8111-111111111111" });
const artifactFor = (ref: string, s = 5) => ({ name: "a", source_ids: [ref], category: "c", processed_text: "t", selection_reason: "r",
  evidence: [{ source_id: ref, start_seconds: s, end_seconds: s + 5, passage: "p" }] });
const sequence = (...replies: (object | Response)[]) => {
  const bodies: any[] = [];
  const f = (async (_u: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    const next = replies[Math.min(bodies.length - 1, replies.length - 1)];
    return next instanceof Response ? next.clone() : Response.json({ choices: [{ message: { content: JSON.stringify(next) }, finish_reason: "stop" }] });
  }) as unknown as typeof fetch;
  return { f, bodies };
};

test("digest requests keep a fixed sampling seed and preserve configured reasoning", async () => {
  const previous = process.env.OPENAI_REASONING_EFFORT;
  process.env.OPENAI_REASONING_EFFORT = "high";
  try {
    const { f, bodies } = sequence({ artifacts: [], exclusions: [] });
    await digest(f);
    await digest(f);
    assert.equal(bodies[0].seed, 0);
    assert.equal(bodies[0].reasoning_effort, "high");
    assert.equal(bodies[0].temperature, undefined);
    assert.deepEqual(bodies[0], bodies[1], "the same source and settings emit the same sampling request");
  } finally {
    if (previous === undefined) delete process.env.OPENAI_REASONING_EFFORT;
    else process.env.OPENAI_REASONING_EFFORT = previous;
  }
});

test("the model sees short refs, not UUIDs, and refs resolve to real unit ids", async () => {
  const units = [ready(1), ready(2)];
  const { f, bodies } = sequence({ artifacts: [{ ...artifactFor("u2"), source_ids: ["u1", "u2"] }], exclusions: [] });
  const out = await runDigestion({ apiKey: "k", units, request: "r", fetchImpl: f });
  const sent = JSON.parse(bodies[0].messages[1].content);
  assert.deepEqual(sent.units.map((u: any) => u.ref), ["u1", "u2"]);
  assert.ok(!JSON.stringify(sent).includes(units[0].id), "no UUIDs in the prompt");
  assert.deepEqual(out.artifacts[0].source_ids, [units[0].id, units[1].id]);
  assert.equal(out.artifacts[0].evidence[0].source_id, units[1].id);
});

test("a cited unit that was not supplied is retried with the error, then accepted", async () => {
  const { f, bodies } = sequence({ artifacts: [artifactFor("u99")], exclusions: [] }, { artifacts: [artifactFor("u1")], exclusions: [] });
  const out = await runDigestion({ apiKey: "k", units: [ready(1)], request: "r", fetchImpl: f });
  assert.equal(bodies.length, 2);
  const retryPrompt = bodies[1].messages.at(-1).content;
  assert.match(retryPrompt, /"u99", which is not one of the supplied units \(valid refs: u1\)/);
  assert.equal(bodies[1].messages.at(-2).role, "assistant");
  assert.equal(out.artifacts.length, 1);
});

test("malformed JSON is also corrected on retry; persistent failure reports the last error", async () => {
  const text = (content: string) => Response.json({ choices: [{ message: { content }, finish_reason: "stop" }] });
  const a = sequence(text("{nope"), { artifacts: [artifactFor("u1")], exclusions: [] });
  assert.equal((await runDigestion({ apiKey: "k", units: [ready(1)], request: "r", fetchImpl: a.f })).artifacts.length, 1);
  const b = sequence({ artifacts: [artifactFor("u9")], exclusions: [] });
  await assert.rejects(runDigestion({ apiKey: "k", units: [ready(1)], request: "r", fetchImpl: b.f }), /"u9".*\(after 2 attempts\)/);
  assert.equal(b.bodies.length, 2);
});

test("HTTP failures and truncation are not retried", async () => {
  const http = sequence(new Response("boom", { status: 500 }));
  await assert.rejects(runDigestion({ apiKey: "k", units: [ready(1)], request: "r", fetchImpl: http.f }), /HTTP 500/);
  assert.equal(http.bodies.length, 1);
  const cut = sequence(Response.json({ choices: [{ message: { content: "" }, finish_reason: "length" }] }));
  await assert.rejects(runDigestion({ apiKey: "k", units: [ready(1)], request: "r", fetchImpl: cut.f }), /output cap/);
  assert.equal(cut.bodies.length, 1);
});

test("a cited moment where nothing was extracted is retried with the reason", async () => {
  // The unit's only extracted evidence is 5-20s.
  const { f, bodies } = sequence({ artifacts: [artifactFor("u1", 200)], exclusions: [] }, { artifacts: [artifactFor("u1", 6)], exclusions: [] });
  const out = await runDigestion({ apiKey: "k", units: [ready(1)], request: "r", fetchImpl: f });
  assert.equal(out.artifacts[0].evidence[0].start_seconds, 6);
  assert.match(bodies[1].messages.at(-1).content, /200-205s .* where nothing was extracted/);
});
