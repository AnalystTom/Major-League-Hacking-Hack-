import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { processUnits } from "../../src/ingest/processor.js";
import { MemoryStore } from "../../src/ingest/store.js";
import { mockFetch } from "./helpers.js";
import { DEFAULT_CATEGORIZATION_REQUEST } from "../../src/ingest/digest/prompt.js";
import { runDigestion } from "../../src/ingest/digest/run.js";
import { extractXPostPublic } from "../../src/ingest/extract/xpost.js";
import { extractUnit } from "../../src/ingest/pipeline.js";
import type { IngestedUnit } from "../../src/ingest/types.js";

process.env.TWITTERAPI_MIN_INTERVAL_MS = "0"; // no pacing in tests

const POST = "1850000000000000001";

function xUnit(): IngestedUnit {
  return {
    id: randomUUID(), submittedUrl: `https://x.com/someone/status/${POST}?s=20`, sourceUrl: `https://x.com/i/status/${POST}`, startSeconds: null,
    title: null, contentType: "x_post", transcript: null, extractionMethod: null, extractedAt: null, status: "pending", error: null,
  };
}

/**
 * The shared mock plus a twitterapi.io route (records the API key it was called with) and X's public embed route,
 * which by default says the post doesn't exist.
 */
function withX(reply: () => Response, embed: () => Response = () => new Response("", { status: 404 })) {
  const { impl, calls } = mockFetch();
  const x = { calls: 0, auth: "", embed: 0 };
  const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    if (String(url).startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
      x.embed++;
      assert.match(String(url), new RegExp(`id=${POST}&token=\\w+$`));
      return embed();
    }
    if (String(url).startsWith("https://api.twitterapi.io/twitter/tweets")) {
      x.calls++;
      x.auth = init?.headers?.["x-api-key"] ?? "";
      assert.ok(String(url).endsWith(`tweet_ids=${POST}`));
      return reply();
    }
    return (impl as unknown as typeof fetch)(url, init as RequestInit);
  }) as unknown as typeof fetch;
  return { fetchImpl, x, calls };
}

const opts = (store: MemoryStore, fetchImpl: typeof fetch, twitterApiKey?: string) =>
  ({ geminiKey: "k", openaiKey: "o", twitterApiKey, store, fetchImpl, retries: 0, pollMs: 1, waitTimeoutMs: 500 });

test("an X post is read from twitterapi.io, then digested like any other unit, without Gemini", async () => {
  const store = new MemoryStore();
  const unit = xUnit();
  await store.saveUnit(unit);
  const { fetchImpl, x, calls } = withX(() => Response.json({
    status: "success", message: "success",
    tweets: [{ id: POST, text: "Use evals before you ship an agent.\nSeriously.", createdAt: "Wed Sep 30 10:00:00 +0000 2026",
      author: { userName: "someone", name: "Some One" }, quoted_tweet: { text: "Agents fail quietly.", author: { userName: "other" } } }],
  }));
  const summary = await processUnits([unit.id], opts(store, fetchImpl, "tok"));

  const saved = (await store.getUnits([unit.id]))[0];
  assert.equal(saved.status, "ready");
  assert.equal(saved.extractionMethod, "twitterapi.io:tweets:v2");
  assert.equal(x.auth, "tok");
  assert.equal(calls.gemini, 0);
  assert.equal(saved.title, "@someone: Use evals before you ship an agent. Seriously.");
  assert.deepEqual(saved.transcript?.window, [0, 0]);
  assert.equal(saved.transcript?.evidence_items[0].observed_spoken_content, "Use evals before you ship an agent.\nSeriously.\n\nQuoted post by @other: Agents fail quietly.");
  assert.match(saved.transcript?.overview ?? "", /Some One \(@someone\) on 2026-09-30/);
  assert.equal(summary.digested, 1);
  assert.equal(store.artifacts[0].sources[0].content_type, "x_post");
});

test("X posts fail with the real reason: missing key, unavailable post, API error", async () => {
  const cases: [string | undefined, () => Response, RegExp][] = [
    [undefined, () => Response.json({}), /X post unavailable/],
    ["tok", () => Response.json({ status: "success", message: "success", tweets: [] }), /X post unavailable/],
    ["tok", () => Response.json({ status: "error", message: "tweet not found" }), /twitterapi.io error: tweet not found/],
    ["bad", () => new Response("Unauthorized", { status: 401 }), /twitterapi.io HTTP 401/],
  ];
  for (const [token, reply, error] of cases) {
    const store = new MemoryStore();
    const unit = xUnit();
    await store.saveUnit(unit);
    const { fetchImpl } = withX(reply);
    await processUnits([unit.id], opts(store, fetchImpl, token));
    const saved = (await store.getUnits([unit.id]))[0];
    assert.equal(saved.status, "failed");
    assert.match(saved.error ?? "", error);
    assert.equal(store.artifacts.length, 0);
  }
});

test("a 429 from twitterapi.io is retried and the post is then read", async () => {
  const store = new MemoryStore();
  const unit = xUnit();
  await store.saveUnit(unit);
  let n = 0;
  const { fetchImpl, x } = withX(() => n++ < 2
    ? new Response(JSON.stringify({ error: "Too Many Requests" }), { status: 429 })
    : Response.json({ status: "success", message: "success", tweets: [{ id: POST, text: "Hello", author: { userName: "someone" } }] }));
  await processUnits([unit.id], opts(store, fetchImpl, "tok"));
  assert.equal((await store.getUnits([unit.id]))[0].status, "ready");
  assert.equal(x.calls, 3);
});

test("a 429 that never clears fails with the real error after the retries", async () => {
  const store = new MemoryStore();
  const unit = xUnit();
  await store.saveUnit(unit);
  const { fetchImpl, x } = withX(() => new Response("Too Many Requests", { status: 429 }));
  await processUnits([unit.id], opts(store, fetchImpl, "tok"));
  const saved = (await store.getUnits([unit.id]))[0];
  assert.equal(saved.status, "failed");
  assert.match(saved.error ?? "", /twitterapi.io HTTP 429/);
  assert.equal(x.calls, 4);
});

const embedPost = (over: object = {}) => Response.json({
  __typename: "Tweet", id_str: POST, text: "Everyone's selling guides on how to grow on X. Here's mine, for free.", created_at: "2026-10-17T12:43:16.000Z",
  user: { screen_name: "someone", name: "Some One" }, ...over,
});

test("an X post link is read from X's public embed route when there is no twitterapi.io key, and is digested", async () => {
  const store = new MemoryStore();
  const unit = xUnit();
  await store.saveUnit(unit);
  const { fetchImpl, x, calls } = withX(() => Response.json({}), () => embedPost());
  const summary = await processUnits([unit.id], opts(store, fetchImpl));

  const saved = (await store.getUnits([unit.id]))[0];
  assert.equal(saved.status, "ready");
  assert.equal(saved.error, null);
  assert.equal(saved.extractionMethod, "x-embed:tweet-result:v2");
  assert.equal(saved.title, "@someone: Everyone's selling guides on how to grow on X. Here's mine, for free.");
  assert.match(saved.transcript?.overview ?? "", /Some One \(@someone\) on 2026-10-17/);
  assert.equal(x.calls + calls.gemini, 0); // no twitterapi.io call and nothing sent to Gemini
  assert.equal(summary.digested, 1);
});

test("a non-engineering post is passed to the digest like any other post", async () => {
  const store = new MemoryStore();
  const unit = xUnit();
  await store.saveUnit(unit);
  const { fetchImpl, calls } = withX(() => Response.json({}), () => embedPost({ text: "My sourdough starter finally doubled overnight." }));
  await processUnits([unit.id], opts(store, fetchImpl));
  const sent = calls.lastDigestRequest as { units: { content_type: string; evidence_items: { observed_spoken_content: string }[] }[] };
  assert.equal(sent.units[0].content_type, "x_post");
  assert.equal(sent.units[0].evidence_items[0].observed_spoken_content, "My sourdough starter finally doubled overnight.");
  assert.equal(store.artifacts.filter((a) => a.ingestion_status === "ready").length, 1);
});

test("an X Article read through the embed route keeps its title and preview", async () => {
  const store = new MemoryStore();
  const unit = xUnit();
  await store.saveUnit(unit);
  const { fetchImpl } = withX(() => Response.json({}), () => embedPost({ text: "https://t.co/abc", article: { title: "0 to 5,000 followers", preview_text: "What I did and what failed." } }));
  await processUnits([unit.id], opts(store, fetchImpl));
  const saved = (await store.getUnits([unit.id]))[0];
  assert.equal(saved.status, "ready");
  assert.equal(saved.title, "@someone: 0 to 5,000 followers");
  assert.equal(saved.transcript?.evidence_items[0].observed_spoken_content, "Article: 0 to 5,000 followers\n\nWhat I did and what failed.");
});

test("the captured pfernan95dev post retains its introduction and supplied article preview without keys", async () => {
  const post = JSON.parse(readFileSync(new URL("./fixtures/xpost-2111437891322745223.json", import.meta.url), "utf8"));
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://cdn.syndication.twimg.com/tweet-result");
    assert.equal(url.searchParams.get("id"), "2111437891322745223");
    assert.equal(init?.headers, undefined);
    return Response.json(post);
  };
  const read = await extractXPostPublic({ postId: post.id_str, fetchImpl });
  assert.equal(read.title, `@pfernan95dev: ${post.article.title}`);
  assert.equal(read.transcript.evidence_items[0].observed_spoken_content,
    `${post.text}\n\nArticle: ${post.article.title}\n\n${post.article.preview_text}`);
  assert.deepEqual(read.transcript.window, [0, 0]);
  const store = new MemoryStore();
  const saved = await extractUnit({ ...xUnit(), sourceUrl: `https://x.com/i/status/${post.id_str}`, status: "running" }, { geminiKey: "", store, fetchImpl });
  assert.equal(saved.status, "ready");
  assert.equal(saved.extractionMethod, "x-embed:tweet-result:v2");
  assert.deepEqual(saved.transcript, read.transcript);
});

test("twitterapi.io failures and empty results both allow the public route to read the post", async () => {
  for (const primary of [() => new Response("down", { status: 503 }), () => Response.json({ status: "success", tweets: [] })]) {
    const store = new MemoryStore();
    const unit = xUnit();
    await store.saveUnit(unit);
    const { fetchImpl, x } = withX(primary, () => embedPost());
    await processUnits([unit.id], opts(store, fetchImpl, "tok"));
    const saved = (await store.getUnits([unit.id]))[0];
    assert.equal(saved.status, "ready");
    assert.equal(saved.extractionMethod, "x-embed:tweet-result:v2");
    assert.equal(saved.transcript?.evidence_items[0].observed_spoken_content, "Everyone's selling guides on how to grow on X. Here's mine, for free.");
    assert.equal(x.embed, 1);
  }
});

test("a link that isn't a YouTube video is never sent to Gemini as a file", async () => {
  const store = new MemoryStore();
  const unit: IngestedUnit = { ...xUnit(), contentType: "youtube_video" };
  await store.saveUnit(unit);
  const { impl, calls } = mockFetch();
  await processUnits([unit.id], opts(store, impl));
  const saved = (await store.getUnits([unit.id]))[0];
  assert.equal(saved.status, "failed");
  assert.match(saved.error ?? "", /not a YouTube, X or Substack URL/);
  assert.equal(calls.gemini, 0);
});

test("runDigestion sends topic-neutral instructions and non-engineering X evidence to the model", async () => {
  const unit: IngestedUnit = { ...xUnit(), status: "ready", transcript: { window: [0, 0], evidence_items: [
    { start_seconds: 0, end_seconds: 0, observed_spoken_content: "My sourdough starter finally doubled overnight." },
  ] } };
  const { impl, calls } = mockFetch();
  let sent: { messages: { role: string; content: string }[] } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    assert.equal(init?.method, "POST");
    sent = JSON.parse(String(init?.body));
    return impl(url, init);
  };
  const result = await runDigestion({ apiKey: "k", units: [unit], request: DEFAULT_CATEGORIZATION_REQUEST, fetchImpl });
  assert.equal(calls.openai, 1);
  assert.ok(sent);
  assert.deepEqual(sent.messages.map((m) => m.role), ["system", "user"]);
  assert.match(sent.messages[0].content, /Any source with substantive content[^\n]*whatever its topic/);
  assert.match(sent.messages[0].content, /Exclude a source only when it has nothing to explain/);
  const user = JSON.parse(sent.messages[1].content);
  assert.match(user.categorization_request, /on any topic/);
  assert.doesNotMatch(`${sent.messages[0].content}\n${user.categorization_request}`, /AI engineer|engineering problem/i);
  assert.deepEqual(user.units, [{ ref: "u1", source_url: unit.sourceUrl, title: null, content_type: "x_post", evidence_items: unit.transcript?.evidence_items }]);
  assert.deepEqual(result.artifacts[0].source_ids, [unit.id]);
});
