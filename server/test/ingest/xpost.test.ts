import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { processUnits } from "../../src/ingest/processor.js";
import { MemoryStore } from "../../src/ingest/store.js";
import { mockFetch } from "./helpers.js";
import type { IngestedUnit } from "../../src/ingest/types.js";

const POST = "1850000000000000001";

function xUnit(): IngestedUnit {
  return {
    id: randomUUID(), submittedUrl: `https://x.com/someone/status/${POST}?s=20`, sourceUrl: `https://x.com/i/status/${POST}`, startSeconds: null,
    title: null, contentType: "x_post", transcript: null, extractionMethod: null, extractedAt: null, status: "pending", error: null,
  };
}

/** The shared mock plus a twitterapi.io route; records the API key it was called with. */
function withX(reply: () => Response) {
  const { impl, calls } = mockFetch();
  const x = { calls: 0, auth: "" };
  const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
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
    [undefined, () => Response.json({}), /TWITTERAPI_IO_KEY is not configured/],
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
