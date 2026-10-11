import test from "node:test";
import assert from "node:assert/strict";
import { parseSourceUrl, parseSubstackUrl } from "../../src/ingest/urls.js";
import { extractWithNimble, parsePost } from "../../src/ingest/extract/nimble.js";
import { ingestLink } from "../../src/ingest/pipeline.js";
import { MemoryStore } from "../../src/ingest/store.js";
import { validateDigest } from "../../src/ingest/digest/validate.js";
import { buildUserMessage } from "../../src/ingest/digest/prompt.js";

const para = (n: number) => `Paragraph ${n}: ${"retrieval pipelines need evals before they need more context. ".repeat(3)}`;
const article = (n = 8) => `![hero](https://x/y.png)\n\n# Evals first\n\nSubtitle line\n\n${Array.from({ length: n }, (_, i) => para(i)).join("\n\n")}\n\n## Discussion about this post\n\nComments here`;
const nimble = (markdown: string | undefined, extra: object = {}) => (async () =>
  Response.json({ status: "success", status_code: 200, data: { markdown }, ...extra })) as unknown as typeof fetch;

test("Substack links are canonicalized; other hosts and non-posts are rejected", () => {
  assert.equal(parseSubstackUrl("https://newsletter.substack.com/p/evals-first?utm_source=share&r=1#comments").sourceUrl, "https://newsletter.substack.com/p/evals-first");
  assert.equal(parseSubstackUrl("https://open.substack.com/pub/newsletter/p/evals-first?r=2").sourceUrl, "https://newsletter.substack.com/p/evals-first");
  assert.equal(parseSourceUrl("https://youtu.be/VQy50fuxI34").contentType, "youtube_video");
  assert.equal(parseSourceUrl("https://a.substack.com/p/x").contentType, "substack_post");
  for (const bad of ["https://newsletter.substack.com/", "https://newsletter.substack.com/archive", "https://substack.com/@someone", "https://www.substack.com/p/x", "https://example.com/p/x", "nope"])
    assert.throws(() => parseSourceUrl(bad), bad);
});

test("parsePost drops chrome, numbers sections and takes the title from the heading", () => {
  const r = parsePost(article());
  assert.equal(r.title, "Evals first");
  assert.equal(r.transcript.sections.length, 9); // subtitle + 8 paragraphs; no image line, no comments
  assert.deepEqual(r.transcript.sections.map((s) => s.index), [...Array(9).keys()]);
  assert.ok(!r.transcript.sections.some((s) => /Comments here|hero/.test(s.text)));
});

test("paywalled and empty pages fail with a specific reason", () => {
  assert.throws(() => parsePost("# T\n\nThis post is for paid subscribers\n\nSubscribe to continue reading"), /paywalled/);
  assert.throws(() => parsePost("# T\n\nshort"), /no readable post text/);
});

test("Nimble HTTP errors, blocked pages and missing content surface real errors", async () => {
  const o = { apiKey: "k", sourceUrl: "https://a.substack.com/p/x", retries: 0 };
  await assert.rejects(extractWithNimble({ ...o, fetchImpl: (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch }), /Nimble HTTP 401/);
  await assert.rejects(extractWithNimble({ ...o, fetchImpl: nimble(article(), { status_code: 404 }) }), /404/);
  await assert.rejects(extractWithNimble({ ...o, fetchImpl: nimble(undefined) }), /no page content/);
  await assert.rejects(extractWithNimble({ ...o, fetchImpl: nimble(article(), { status: "failed" }) }), /could not fetch/);
});

test("Nimble 5xx is retried and sends the canonical URL with the bearer key", async () => {
  let calls = 0; let seen: any;
  const fetchImpl = (async (_u: string, init: any) => {
    seen = { auth: init.headers.authorization, body: JSON.parse(init.body) };
    return ++calls === 1 ? new Response("busy", { status: 503 }) : Response.json({ status: "success", data: { markdown: article() } });
  }) as unknown as typeof fetch;
  const r = await extractWithNimble({ apiKey: "secret", sourceUrl: "https://a.substack.com/p/x", fetchImpl, retryDelayMs: 1 });
  assert.equal(calls, 2);
  assert.equal(seen.auth, "Bearer secret");
  assert.equal(seen.body.url, "https://a.substack.com/p/x");
  assert.equal(r.title, "Evals first");
});

test("a Substack link becomes a ready text unit, and digests cite sections", async () => {
  const store = new MemoryStore();
  const u = await ingestLink("https://newsletter.substack.com/p/evals-first?utm_source=x", { geminiKey: "g", nimbleKey: "n", store, fetchImpl: nimble(article()) });
  assert.equal(u.status, "ready");
  assert.equal(u.contentType, "substack_post");
  assert.equal(u.sourceUrl, "https://newsletter.substack.com/p/evals-first");
  assert.equal(u.title, "Evals first");
  assert.match(u.extractionMethod!, /^nimble/);
  const sent = JSON.parse(buildUserMessage([u], "req")).units[0];
  assert.equal(sent.content_type, "substack_post");
  assert.ok(sent.sections.length && !sent.evidence_items);

  const art = (section: number | undefined, extra = {}) => ({ name: "a", source_ids: [u.id], category: "c", processed_text: "t", selection_reason: "r",
    evidence: [{ source_id: u.id, section, passage: "p", ...extra }] });
  assert.doesNotThrow(() => validateDigest({ artifacts: [art(3)], exclusions: [] }, [u]));
  assert.throws(() => validateDigest({ artifacts: [art(99)], exclusions: [] }, [u]), /existing section/);
  assert.throws(() => validateDigest({ artifacts: [art(undefined, { start_seconds: 1, end_seconds: 2 })], exclusions: [] }, [u]), /existing section/);
});

test("without a Nimble key the unit fails clearly and a paywalled post is not ready", async () => {
  const store = new MemoryStore();
  const a = await ingestLink("https://a.substack.com/p/x", { geminiKey: "g", store });
  assert.equal(a.status, "failed");
  assert.match(a.error!, /NIMBLE_API_KEY/);
  const b = await ingestLink("https://a.substack.com/p/y", { geminiKey: "g", nimbleKey: "n", store, fetchImpl: nimble("# T\n\nThis post is for paid subscribers") });
  assert.equal(b.status, "failed");
  assert.match(b.error!, /paywalled/);
  assert.equal((await store.listReadyUnits()).length, 0);
});
