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
  assert.equal(r.transcript.sections.length, 8); // the 8 paragraphs; no image line, short byline line or comments
  assert.deepEqual(r.transcript.sections.map((s) => s.index), [...Array(8).keys()]);
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

// Shaped like a real Nimble reply for a Substack post: logo heading, nav, byline, counters, image-only links.
const body = (n: number) => Array.from({ length: n }, (_, i) => `**Point ${i}.** A harness is [the walls](https://x.dev/a) around a loop, with the sandbox and the gates that decide "done".`.repeat(2));
const realPage = (paragraphs: string[], tail = "") => [
  "[![Elevate](https://substackcdn.com/image/fetch/logo.png)](https://addyo.substack.com/)",
  "# [![Elevate](https://substackcdn.com/image/fetch/logo.png)](https://addyo.substack.com/)",
  "SubscribeSign in", "# Software Factories, Light and Dark", "### Loops, harnesses, factories.",
  "[](https://substack.com/@addyosmani)", "[Addy Osmani](https://substack.com/@addyosmani)", "Jul 22, 2026", "115", "7", "10", "Share",
  ...paragraphs, tail,
].join("\n\n");

test("the post title wins over the publication logo heading, and page chrome is dropped", () => {
  const r = parsePost(realPage(body(6), "## Discussion about this post\n\nComments"));
  assert.equal(r.title, "Software Factories, Light and Dark");
  const text = r.transcript.sections.map((s) => s.text);
  for (const junk of ["SubscribeSign in", "Share", "115", "Jul 22, 2026", "[](", "https://", "**"]) assert.ok(!text.some((t) => t === junk || t.includes(junk)), junk);
  assert.ok(text.includes("Loops, harnesses, factories.".replace(/^/, "### ")) || text.some((t) => t.includes("Loops, harnesses")));
  assert.match(text.find((t) => t.startsWith("Point 0."))!, /A harness is the walls around a loop/);
});

test("a paywalled post is rejected even when its free preview is long", () => {
  const long = body(40);
  assert.ok(long.join(" ").length > 2000);
  assert.throws(() => parsePost(realPage(long, "## Subscribe to continue reading\n\nThis post is for paid subscribers")), /paywalled/);
  assert.throws(() => parsePost(realPage(long), { paywall: "Upgrade to paid" }), /paywalled/);
});

test("parser fields win when present: title, subtitle, author and body list", () => {
  const r = parsePost("# [![logo](x)](y)\n\nignored markdown", {
    title: " The Real  Title ", subtitle: "A subtitle", author: "Addy Osmani",
    body: [...body(4), "Share", "12", 7],
  });
  assert.equal(r.title, "The Real Title");
  assert.equal(r.transcript.overview, "A subtitle By Addy Osmani.");
  assert.equal(r.transcript.sections.length, 4);
  assert.ok(r.transcript.sections.every((s) => !s.text.includes("](")));
});

test("an empty parser body falls back to the markdown; empty everything fails clearly", () => {
  assert.equal(parsePost(realPage(body(6)), { body: [], paywall: null }).transcript.sections.length > 3, true);
  assert.throws(() => parsePost("# [![logo](x)](y)\n\nSubscribeSign in", { body: [] }), /no readable post text/);
});

test("the Nimble request asks for the parser fields and a null paywall field does not reject", async () => {
  let sent: any;
  const fetchImpl = (async (_u: string, init: any) => {
    sent = JSON.parse(init.body);
    return Response.json({ status: "success", data: { markdown: realPage(body(6)), parsing: { title: "T", body: body(6), paywall: null } } });
  }) as unknown as typeof fetch;
  const r = await extractWithNimble({ apiKey: "k", sourceUrl: "https://a.substack.com/p/x", fetchImpl, retries: 0 });
  assert.equal(r.title, "T");
  assert.equal(sent.parse, true);
  assert.deepEqual(Object.keys(sent.parser).sort(), ["author", "body", "paywall", "subtitle", "title"]);
  assert.equal(sent.parser.body.type, "terminal_list");
});
