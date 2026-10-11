import test from "node:test";
import assert from "node:assert/strict";
import { isPermanentFailure } from "../../src/outputs/retry.js";
import { MemoryOutputStore } from "../../src/outputs/store.js";
import { produceOutputs } from "../../src/outputs/run.js";
import { artifact, outputsFetch } from "./helpers.js";

test("failures that can't change by retrying are final; transient ones aren't", () => {
  const final = [
    "TTS HTTP 402: Your prepayment credits are depleted. Please go to AI Studio",
    "TTS HTTP 429: Rate limit exceeded for model gemini-3.8-flash-tts (limit: 10 requests per day on Free Tier).",
    "OpenAI HTTP 429: You exceeded your current quota, please check your plan and billing details.",
    "OpenAI HTTP 400: Unsupported parameter",
    "Gemini HTTP 403: The caller does not have permission",
    "R2 upload of videos/a/1/short.mp4 failed: HTTP 403 AccessDenied",
    "Media storage isn't configured on the processor (R2_* or MEDIA_LOCAL_WEB_DIR)",
    "OPENAI_API_KEY isn't configured on the processor",
  ];
  const transient = [
    "OpenAI HTTP 429: Rate limit reached for gpt-5 on requests per min. Please try again in 2s.",
    "OpenAI HTTP 500: The server had an error",
    "TTS HTTP 503: overloaded",
    "TTS HTTP 408: request timeout",
    "TTS request failed: fetch failed",
    "script narration is 30 words; expected about 70-110",
    "OpenAI hit the 20000-token output cap before finishing (19000 reasoning tokens)",
  ];
  for (const m of final) assert.equal(isPermanentFailure(m), true, m);
  for (const m of transient) assert.equal(isPermanentFailure(m), false, m);
});

test("a permanent failure isn't retried, a transient one is", async () => {
  const media = { put: async (k: string) => `r2:${k}` };
  const a = artifact();
  const depleted = new MemoryOutputStore(0);
  depleted.artifacts.push(a);
  await produceOutputs([a], { outputs: depleted, openaiKey: "o", geminiKey: "g", media, fetchImpl: outputsFetch(a, { ttsStatus: 402 }).impl });
  const v = [...depleted.rows.video.values()][0];
  assert.equal(v.status, "failed");
  assert.equal(v.attempts, 3, "final: no attempts left");
  assert.deepEqual(await depleted.artifactsNeeding("video", 10), []);

  const flaky = new MemoryOutputStore(0);
  flaky.artifacts.push(a);
  await produceOutputs([a], { outputs: flaky, openaiKey: "o", geminiKey: "g", media, fetchImpl: outputsFetch(a, { ttsStatus: 503 }).impl });
  assert.equal([...flaky.rows.video.values()][0].attempts, 1);
  assert.equal((await flaky.artifactsNeeding("video", 10)).length, 1, "retried later");
});

test("with no room under the limits, a retry waits instead of spending", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore(0);
  const o = { outputs, openaiKey: "o", media: null, fetchImpl: outputsFetch(a, { openaiStatus: 500 }).impl, limits: { daily: 10, monthly: 40 } };
  await produceOutputs([a], o);
  assert.equal([...outputs.rows.skill.values()][0].attempts, 1, "the first attempt failed transiently");
  outputs.retriesAllowed = 0;
  assert.equal(await outputs.claim("skill", a, o.limits), null, "no room: not claimed");
  outputs.retriesAllowed = 1;
  assert.ok(await outputs.claim("skill", a, o.limits), "room: claimed and charged");
  assert.equal(outputs.retriesCharged, 1);
});
