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

/** The shared mock plus an X API route; records the bearer token it was called with. */
function withX(reply: () => Response) {
  const { impl, calls } = mockFetch();
  const x = { calls: 0, auth: "" };
  const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    if (String(url).startsWith("https://api.x.com/2/tweets/")) {
      x.calls++;
      x.auth = init?.headers?.authorization ?? "";
      assert.ok(String(url).includes(`/tweets/${POST}?`));
      return reply();
    }
    return (impl as unknown as typeof fetch)(url, init as RequestInit);
  }) as unknown as typeof fetch;
  return { fetchImpl, x, calls };
}

const opts = (store: MemoryStore, fetchImpl: typeof fetch, xBearerToken?: string) =>
  ({ geminiKey: "k", openaiKey: "o", xBearerToken, store, fetchImpl, retries: 0, pollMs: 1, waitTimeoutMs: 500 });

test("an X post is read from the X API, then digested like any other unit, without Gemini", async () => {
  const store = new MemoryStore();
  const unit = xUnit();
  await store.saveUnit(unit);
  const { fetchImpl, x, calls } = withX(() => Response.json({
    data: { id: POST, text: "short text", note_tweet: { text: "Use evals before you ship an agent.\nSeriously." }, author_id: "7", created_at: "2026-09-30T10:00:00Z" },
    includes: { users: [{ id: "7", name: "Some One", username: "someone" }] },
  }));
  const summary = await processUnits([unit.id], opts(store, fetchImpl, "tok"));

  const saved = (await store.getUnits([unit.id]))[0];
  assert.equal(saved.status, "ready");
  assert.equal(x.auth, "Bearer tok");
  assert.equal(calls.gemini, 0);
  assert.equal(saved.title, "@someone: Use evals before you ship an agent. Seriously.");
  assert.deepEqual(saved.transcript?.window, [0, 0]);
  assert.equal(saved.transcript?.evidence_items[0].observed_spoken_content, "Use evals before you ship an agent.\nSeriously.");
  assert.match(saved.transcript?.overview ?? "", /Some One \(@someone\) on 2026-09-30/);
  assert.equal(summary.digested, 1);
  assert.equal(store.artifacts[0].sources[0].content_type, "x_post");
});

test("X posts fail with the real reason: missing token, unavailable post, API error", async () => {
  const cases: [string | undefined, () => Response, RegExp][] = [
    [undefined, () => Response.json({}), /X_BEARER_TOKEN is not configured/],
    ["tok", () => Response.json({ errors: [{ detail: "Could not find tweet with id: [1]." }] }), /X post unavailable: Could not find tweet/],
    ["bad", () => new Response("Unauthorized", { status: 401 }), /X API HTTP 401/],
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
