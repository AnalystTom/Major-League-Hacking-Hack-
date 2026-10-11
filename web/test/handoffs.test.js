import { test } from "node:test";
import assert from "node:assert/strict";
import { HANDOFF_REVISION, inputKey, isStuck, parseHandoff, requestHandoff, serializeBrief } from "../src/handoffs.js";

const A = "6f1c2a52-8d0e-4f3b-9a51-0c6d2e7b9a10";
const B = "0b6e7a10-1c2d-4e3f-8a9b-2c3d4e5f6a7b";

test("a handoff needs 1-12 distinct skill ids", () => {
  assert.deepEqual(parseHandoff({ skill_ids: [A, A, B] }), { ok: true, value: { skill_ids: [A, B] } });
  assert.equal(parseHandoff({ skill_ids: [] }).ok, false);
  assert.equal(parseHandoff({}).ok, false);
  assert.equal(parseHandoff({ skill_ids: ["not-a-uuid"] }).ok, false);
  assert.equal(parseHandoff({ skill_ids: Array.from({ length: 13 }, (_, i) => A.replace(/0$/, String(i % 10)) + i) }).ok, false);
});

test("the same skill revisions in any order share a brief; a regenerated skill doesn't", () => {
  const at = "2026-10-11T18:00:00Z";
  const k = inputKey([{ id: A, updated_at: at }, { id: B, updated_at: at }]);
  assert.equal(k, inputKey([{ id: B, updated_at: at }, { id: A, updated_at: at }]));
  assert.notEqual(k, inputKey([{ id: A, updated_at: "2026-10-11T18:05:00Z" }, { id: B, updated_at: at }]));
  assert.ok(k.endsWith(`|${HANDOFF_REVISION}`));
});

test("the processor is asked next to PROCESSOR_URL, with the bearer token", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url: String(url), init }; return new Response(null, { status: 202 }); };
  const env = { PROCESSOR_URL: "http://127.0.0.1:3000/api/ingest/process", PROCESSOR_TOKEN: "t" };
  assert.equal(await requestHandoff(env, A, fetchImpl), "requested");
  assert.equal(seen.url, "http://127.0.0.1:3000/api/ingest/handoff");
  assert.equal(seen.init.headers.authorization, "Bearer t");
  assert.deepEqual(JSON.parse(seen.init.body), { brief_id: A });
  assert.equal(await requestHandoff({}, A, fetchImpl), "not_configured");
  assert.equal(await requestHandoff(env, A, async () => new Response("no", { status: 404 })), "unavailable");
  assert.equal(await requestHandoff(env, A, async () => { throw new Error("down"); }), "unavailable");
});

test("only a ready brief carries prompts; a failed one carries its actual error", () => {
  const prompts = { codex: { review: "r", apply: "a" } };
  const ready = serializeBrief({ id: A, status: "ready", skill_result_ids: [B], prompts,
    brief: { title: "T", summary: "S", themes: [{ name: "N", skills: ["x"] }], tensions: [{ topic: "Unit or e2e" }], actions: [{ title: "Do", skills: ["x"] }] } });
  assert.equal(ready.title, "T");
  assert.deepEqual(ready.tensions, ["Unit or e2e"]);
  assert.deepEqual(ready.prompts, prompts);
  const failed = serializeBrief({ id: A, status: "failed", error: "OpenAI HTTP 500", skill_result_ids: [B], prompts: null, brief: null });
  assert.equal(failed.error, "OpenAI HTTP 500");
  assert.equal(failed.prompts, null);
  assert.equal(serializeBrief({ id: A, status: "running", error: "old", skill_result_ids: [B] }).error, null);
});

test("a brief nobody picked up, or one abandoned mid-way, is stuck so the page can ask again", () => {
  const now = Date.parse("2026-10-11T20:00:00Z");
  const ago = (min) => new Date(now - min * 60_000).toISOString();
  assert.equal(isStuck({ status: "pending", updated_at: ago(1) }, now), false);
  assert.equal(isStuck({ status: "pending", updated_at: ago(3) }, now), true);
  assert.equal(isStuck({ status: "running", updated_at: ago(5) }, now), false);
  assert.equal(isStuck({ status: "running", updated_at: ago(11) }, now), true);
  assert.equal(isStuck({ status: "ready", updated_at: ago(60) }, now), false);
  assert.equal(isStuck({ status: "failed", updated_at: ago(60) }, now), false);
});
