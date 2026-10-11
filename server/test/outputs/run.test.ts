import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { MemoryOutputStore } from "../../src/outputs/store.js";
import { produceOutputs, sweepOutputs } from "../../src/outputs/run.js";
import type { MediaStore } from "../../src/outputs/render/media.js";
import { artifact, outputsFetch } from "./helpers.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();
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

test("the sweep produces outputs for artifacts that are missing them", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  outputs.artifacts.push(a);
  const { impl } = outputsFetch(a);
  const o = { outputs, openaiKey: "o", media: null, fetchImpl: impl };
  assert.equal(await sweepOutputs(o), 2);
  assert.equal(await sweepOutputs(o), 0, "settled results aren't redone");
});
