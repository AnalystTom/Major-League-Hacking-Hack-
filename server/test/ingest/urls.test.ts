import test from "node:test";
import assert from "node:assert/strict";
import { parseYouTubeUrl } from "../../src/ingest/urls.js";

test("strips Watch Later params and keeps submitted URL", () => {
  const link = "https://www.youtube.com/watch?v=VQy50fuxI34&list=WL&index=4";
  const p = parseYouTubeUrl(link);
  assert.equal(p.sourceUrl, "https://www.youtube.com/watch?v=VQy50fuxI34");
  assert.equal(p.submittedUrl, link);
  assert.equal(p.startSeconds, null);
});
test("preserves selected start time", () => {
  assert.equal(parseYouTubeUrl("https://www.youtube.com/watch?v=V-EDrhIhHzQ&list=WL&index=5&t=306s").startSeconds, 306);
  assert.equal(parseYouTubeUrl("https://youtu.be/V-EDrhIhHzQ?t=1m6s").startSeconds, 66);
});
test("rejects non-YouTube and malformed links", () => {
  assert.throws(() => parseYouTubeUrl("https://example.com/watch?v=VQy50fuxI34"));
  assert.throws(() => parseYouTubeUrl("nope"));
  assert.throws(() => parseYouTubeUrl("https://www.youtube.com/playlist?list=WL"));
});
