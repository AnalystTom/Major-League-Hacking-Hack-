import test from "node:test";
import assert from "node:assert/strict";
import { validateExtraction } from "../src/extract/validate.ts";
import type { ModelExtraction } from "../src/types.ts";

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
