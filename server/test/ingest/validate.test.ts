import test from "node:test";
import assert from "node:assert/strict";
import { validateExtraction } from "../../src/ingest/extract/validate.js";
import type { ModelExtraction } from "../../src/ingest/types.js";

const item = (s: number, e: number) => ({ start_seconds: s, end_seconds: e, observed_spoken_content: "x" });
const req = { sourceUrl: "https://www.youtube.com/watch?v=VQy50fuxI34", window: [0, 300] as [number, number] };
const ex = (over: Partial<ModelExtraction>): ModelExtraction => ({ source_url: req.sourceUrl, content_accessed: true, evidence_items: [], ...over });

test("drops out-of-window items but keeps valid ones", () => {
  const r = validateExtraction(ex({ evidence_items: [item(22, 35), item(338, 435)] }), req);
  assert.equal(r.ok, true);
  assert.equal(r.accepted.length, 1);
  assert.match(r.rejected[0].reason, /outside/);
});
test("rejects a response claiming a different video", () => {
  const r = validateExtraction(ex({ source_url: "https://www.youtube.com/watch?v=0k1j_1m1i0E", evidence_items: [item(1, 2)] }), req);
  assert.equal(r.ok, false);
});
test("not ready without content or any valid item", () => {
  assert.equal(validateExtraction(ex({ content_accessed: false }), req).ok, false);
  assert.equal(validateExtraction(ex({ evidence_items: [item(400, 410)] }), req).ok, false);
});

import { buildRequestBody } from "../../src/ingest/extract/gemini.js";
test("extraction prompt names the video and window so the model can echo them", () => {
  const body = buildRequestBody(req.sourceUrl, [306, 606]);
  const text = body.contents[0].parts[1].text!;
  assert.ok(text.includes(req.sourceUrl) && text.includes("306 to 606"));
});

import { windowFor, MAX_WINDOW_SECONDS } from "../../src/ingest/extract/gemini.js";
test("window is bounded to 1 hour and starts at the selected time", () => {
  assert.deepEqual(windowFor(306), [306, 3906], "default window is one hour from the start");
  assert.deepEqual(windowFor(null), [0, 3600]);
  assert.deepEqual(windowFor(306, 300), [306, 606]);
  assert.deepEqual(windowFor(null, MAX_WINDOW_SECONDS), [0, 3600]);
  assert.throws(() => windowFor(0, 3601));
  assert.throws(() => windowFor(0, 5));
});
test("output budget scales with window", () => {
  assert.equal(buildRequestBody(req.sourceUrl, [0, 300]).generationConfig.maxOutputTokens, 2000);
  assert.equal(buildRequestBody(req.sourceUrl, [0, 3600]).generationConfig.maxOutputTokens, 16000);
});
