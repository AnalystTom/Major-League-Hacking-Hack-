import test from "node:test";
import assert from "node:assert/strict";
process.env.TWITTERAPI_MIN_INTERVAL_MS = "0";
const { extractXPost } = await import("../../src/ingest/extract/xpost.js");
// X Article posts (a link-only post whose body is a long-form article); ordinary posts are covered in xpost.test.ts.

const tweet = (text: string) => ({ status: "success", tweets: [{ id: "42", text, createdAt: "Sun Sep 27 14:29:42 +0000 2026", author: { userName: "0xMovez", name: "Movez" } }] });
const routes = (map: Record<string, { status?: number; body: unknown }>) => {
  const seen: string[] = [];
  const f = (async (url: string) => {
    seen.push(url);
    const key = Object.keys(map).find((k) => url.includes(k))!;
    const r = map[key];
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, seen };
};

test("a post that is only a link to an X Article reads the article's title and body", async () => {
  const { f, seen } = routes({
    "/twitter/tweets": { body: tweet("https://t.co/4qTQfdoerp") },
    "/twitter/article": { body: { status: "success", article: { title: "How to build motion design studio ", preview_text: "Most people…", contents: [{ type: "unstyled", text: "Most people end up with the same video." }, { type: "header-two", text: "Give it a reference" }, { type: "unstyled", text: "" }] } } },
  });
  const r = await extractXPost({ apiKey: "k", postId: "42", fetchImpl: f });
  assert.equal(seen.length, 2);
  assert.match(seen[1], /\/twitter\/article\?tweet_id=42/);
  const body = r.transcript.evidence_items[0].observed_spoken_content;
  assert.equal(body, "Article: How to build motion design studio\n\nMost people end up with the same video.\n\nGive it a reference");
  assert.equal(r.title, "@0xMovez: How to build motion design studio");
  assert.match(r.transcript.overview!, /^X Article by Movez \(@0xMovez\) on 2026-09-27/);
});

test("an ordinary post keeps its keyed text without a paid article request", async () => {
  const { f, seen } = routes({
    "/twitter/tweets": { body: tweet("Write the failing check first. https://t.co/x") },
    "tweet-result": { body: { text: "Write the failing check first." } },
  });
  const r = await extractXPost({ apiKey: "k", postId: "42", fetchImpl: f });
  assert.equal(seen.length, 2);
  assert.match(seen[1], /cdn\.syndication\.twimg\.com\/tweet-result/);
  assert.equal(r.transcript.evidence_items[0].observed_spoken_content, "Write the failing check first. https://t.co/x");
  assert.match(r.transcript.overview!, /^X post by/);
});

test("public article evidence supplements keyed introductions and link-only posts while retaining quotes", async () => {
  for (const own of ["Read my guide. https://t.co/abc", "https://t.co/abc"]) {
    const post = tweet(own);
    const { f } = routes({
      "/twitter/tweets": { body: { ...post, tweets: [{ ...post.tweets[0], quoted_tweet: { text: "Original quote", author: { userName: "other" } } }] } },
      "/twitter/article": { status: 404, body: {} },
      "tweet-result": { body: { text: own, article: { title: "Guide", preview_text: "Available article evidence" } } },
    });
    const r = await extractXPost({ apiKey: "k", postId: "42", fetchImpl: f });
    assert.equal(r.title, "@0xMovez: Guide");
    assert.equal(r.transcript.evidence_items[0].observed_spoken_content,
      `${own.startsWith("Read") ? `${own}\n\n` : ""}Article: Guide\n\nAvailable article evidence\n\nQuoted post by @other: Original quote`);
  }
});

test("a link-only post without an article keeps the link, and article errors surface", async () => {
  const none = routes({ "/twitter/tweets": { body: tweet("https://t.co/abc") }, "/twitter/article": { status: 404, body: { status: "error", msg: "not found" } }, "tweet-result": { status: 404, body: {} } });
  assert.equal((await extractXPost({ apiKey: "k", postId: "42", fetchImpl: none.f })).transcript.evidence_items[0].observed_spoken_content, "https://t.co/abc");
  const broken = routes({ "/twitter/tweets": { body: tweet("https://t.co/abc") }, "/twitter/article": { status: 500, body: { msg: "boom" } } });
  await assert.rejects(extractXPost({ apiKey: "k", postId: "42", fetchImpl: broken.f }), /twitterapi\.io article/);
  const errBody = routes({ "/twitter/tweets": { body: tweet("https://t.co/abc") }, "/twitter/article": { body: { status: "error", msg: "quota exceeded" } } });
  await assert.rejects(extractXPost({ apiKey: "k", postId: "42", fetchImpl: errBody.f }), /twitterapi\.io article error: quota exceeded/, "a 200 carrying an error isn't read as 'no article'");
});

test("a 429 on the article request is retried, then the article is read", async () => {
  let articleCalls = 0;
  const f = (async (url: string) => {
    if (url.includes("/twitter/tweets")) return new Response(JSON.stringify(tweet("https://t.co/abc")));
    articleCalls++;
    if (articleCalls === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ status: "success", article: { title: "T", contents: [{ text: "Body" }] } }));
  }) as unknown as typeof fetch;
  const r = await extractXPost({ apiKey: "k", postId: "42", fetchImpl: f });
  assert.equal(articleCalls, 2);
  assert.equal(r.transcript.evidence_items[0].observed_spoken_content, "Article: T\n\nBody");
});
