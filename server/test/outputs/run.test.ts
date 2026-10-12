import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { LostClaim, MemoryOutputStore } from "../../src/outputs/store.js";
import { produceOutputs, sweepOutputs } from "../../src/outputs/run.js";
import type { MediaStore } from "../../src/outputs/render/media.js";
import { artifact, outputsFetch, takeOver } from "./helpers.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();
// These cover the plain ffmpeg renderer; motion-skill.test.ts covers the motion-graphic-skill path.
process.env.RENDER_STYLE = "basic";

const media: MediaStore = { put: async (key) => `r2:${key}` };

test("an artifact gets a ready skill and a ready short, once", { skip: !hasFfmpeg && "ffmpeg not installed", timeout: 120_000 }, async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  const { impl, calls } = outputsFetch(a);
  const o = { outputs, openaiKey: "o", geminiKey: "g", media, fetchImpl: impl };
  await Promise.all([produceOutputs([a], o), produceOutputs([a], o)]);
  const skill = [...outputs.rows.skill.values()];
  const video = [...outputs.rows.video.values()];
  assert.equal(skill.length, 1);
  assert.equal(skill[0].status, "ready");
  assert.equal(video.length, 1);
  assert.equal(video[0].status, "ready", String(video[0].error));
  assert.equal(calls.skill, 1, "duplicate requests don't pay twice");
  assert.equal(calls.script, 1);
});

test("without media storage the short fails with that reason, and the skill still lands", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  const { impl, calls } = outputsFetch(a);
  await produceOutputs([a], { outputs, openaiKey: "o", geminiKey: "g", media: null, fetchImpl: impl });
  assert.equal([...outputs.rows.skill.values()][0].status, "ready");
  const v = [...outputs.rows.video.values()][0];
  assert.equal(v.status, "failed");
  assert.match(v.error!, /Media storage isn't configured/);
  assert.equal(calls.script, 0, "nothing is spent on a render that can't be stored");
});

test("a skill failure is recorded with the provider error", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  const { impl } = outputsFetch(a, { openaiStatus: 500 });
  await produceOutputs([a], { outputs, openaiKey: "o", media: null, fetchImpl: impl });
  const s = [...outputs.rows.skill.values()][0];
  assert.equal(s.status, "failed");
  assert.match(s.error!, /OpenAI HTTP 500/);
});

test("a failed skill is retried by the sweep until it lands, at most MAX_OUTPUT_ATTEMPTS times", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore(0);
  outputs.artifacts.push(a);
  const failing = outputsFetch(a, { openaiStatus: 500 });
  const o = { outputs, openaiKey: "o", media: null, fetchImpl: failing.impl };
  await produceOutputs([a], o);
  const row = () => [...outputs.rows.skill.values()][0];
  assert.equal(row().status, "failed");
  await sweepOutputs(o);
  assert.equal(row().attempts, 2);
  assert.equal(row().status, "failed");
  await sweepOutputs({ ...o, fetchImpl: outputsFetch(a).impl });
  assert.equal(row().status, "ready", "the third attempt succeeds");
  assert.equal(row().attempts, 3);

  const b = artifact();
  const stuck = new MemoryOutputStore(0);
  stuck.artifacts.push(b);
  const down = { outputs: stuck, openaiKey: "o", media: null, fetchImpl: outputsFetch(b, { openaiStatus: 500 }).impl };
  for (let i = 0; i < 5; i++) await sweepOutputs(down);
  const s = [...stuck.rows.skill.values()][0];
  assert.equal(s.attempts, 3);
  assert.equal(s.status, "failed", "after three failures it stays failed with the last error");
  assert.match(s.error!, /OpenAI HTTP 500/);
});

test("a failed result waits before it's retried", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  await produceOutputs([a], { outputs, openaiKey: "o", media: null, fetchImpl: outputsFetch(a, { openaiStatus: 500 }).impl });
  outputs.artifacts.push(a);
  assert.equal((await outputs.artifactsNeeding("skill", 10)).length, 0);
});

test("the sweep produces outputs for artifacts that are missing them", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  outputs.artifacts.push(a);
  const { impl } = outputsFetch(a);
  const o = { outputs, openaiKey: "o", media: null, fetchImpl: impl };
  assert.equal(await sweepOutputs(o), 2);
  assert.equal(await sweepOutputs(o), 0, "settled results aren't redone");
});

test("a worker whose claim was taken over can't save or fail the result", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  const stale = (await outputs.claim("video", a))!;
  takeOver(outputs, "video", stale.id);
  await assert.rejects(outputs.finishVideo(stale, { script: { scenes: [] }, prompt_revision: "r", media_ref: "m", caption_ref: "c", narration_ref: "n", duration_seconds: 1 }), LostClaim);
  assert.equal(await outputs.fail("video", stale, "late"), false);
  assert.equal([...outputs.rows.video.values()][0].status, "running", "the newer worker's row is untouched");
});
