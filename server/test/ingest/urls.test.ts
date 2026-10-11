import test from "node:test";
import assert from "node:assert/strict";
import { isXUrl, parseXPostUrl, parseYouTubeUrl } from "../../src/ingest/urls.js";

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

test("canonicalizes X post links from x.com, twitter.com and share forms", () => {
  for (const link of [
    "https://x.com/someone/status/1850000000000000001?s=20&t=abc",
    "https://twitter.com/someone/status/1850000000000000001",
    "https://mobile.twitter.com/someone/statuses/1850000000000000001/",
    "https://x.com/i/web/status/1850000000000000001",
    "x.com/i/status/1850000000000000001",
  ].map((l) => (l.startsWith("http") ? l : `https://${l}`))) {
    assert.equal(parseXPostUrl(link).sourceUrl, "https://x.com/i/status/1850000000000000001", link);
  }
});
test("rejects X links that are not a single post", () => {
  for (const link of ["https://x.com/someone", "https://x.com/i/bookmarks", "https://x.com.evil.dev/a/status/1", "https://example.com/a/status/1", "nope"])
    assert.throws(() => parseXPostUrl(link), link);
  assert.equal(isXUrl("https://x.com/i/bookmarks"), true);
  assert.equal(isXUrl("https://youtu.be/VQy50fuxI34"), false);
});
