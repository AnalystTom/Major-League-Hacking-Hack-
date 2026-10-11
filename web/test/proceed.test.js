import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXLink } from "../src/xpost.js";
import { parseYouTubeLink } from "../src/youtube.js";
import { describeUnit, parseImport, parseUnitIds } from "../src/imports.js";
import { isMediaKey, parseRange, resolveMediaRef } from "../src/media.js";
import { serializeItem } from "../src/feed.js";
import { requestProcessing } from "../src/processor.js";
import { followImports } from "../public/units.js";

const ID = "6f1c2a52-8d0e-4f3b-9a51-0c6d2e7b9a10";

test("canonicalises the YouTube link shapes people paste", () => {
  const cases = [
    ["https://www.youtube.com/watch?v=VQy50fuxI34&list=WL&index=3", "VQy50fuxI34", null],
    ["https://youtu.be/V-EDrhIhHzQ?t=306", "V-EDrhIhHzQ", 306],
    ["youtube.com/watch?v=V-EDrhIhHzQ&t=5m6s", "V-EDrhIhHzQ", 306],
    ["https://m.youtube.com/shorts/VQy50fuxI34", "VQy50fuxI34", null],
    ["https://www.youtube.com/embed/VQy50fuxI34?start=90", "VQy50fuxI34", 90],
  ];
  for (const [input, id, start] of cases) {
    const r = parseYouTubeLink(input);
    assert.equal(r.ok, true, input);
    assert.equal(r.value.source_url, `https://www.youtube.com/watch?v=${id}`);
    assert.equal(r.value.start_seconds, start, input);
    assert.equal(r.value.submitted_url, input);
  }
});

test("rejects links that aren't a single YouTube video", () => {
  for (const input of ["https://vimeo.com/123", "https://www.youtube.com/playlist?list=WL", "not a url at all", "https://youtube.com.evil.dev/watch?v=VQy50fuxI34"]) {
    assert.equal(parseYouTubeLink(input).ok, false, input);
  }
});

test("parseImport validates, reports every bad line, and de-duplicates", () => {
  const ok = parseImport({ links: "https://youtu.be/VQy50fuxI34\nhttps://www.youtube.com/watch?v=VQy50fuxI34" });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.links.length, 1);

  const bad = parseImport({ links: ["https://youtu.be/VQy50fuxI34", "https://vimeo.com/1"] });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.invalid.map((i) => i.link), ["https://vimeo.com/1"]);

  assert.equal(parseImport({ links: [] }).status, 400);
  assert.equal(parseImport({ links: Array(141).fill("https://youtu.be/VQy50fuxI34") }).status, 400);
  assert.equal(parseImport({ links: "https://youtu.be/VQy50fuxI34", company: "bot" }).status, 202);
  assert.equal(parseImport({ links: [`https://youtu.be/VQy50fuxI34?x=${"a".repeat(3000)}`] }).status, 400);
  assert.equal(parseImport({ links: Array(1000).fill("") }).status, 400);
});

test("parseUnitIds accepts only uuid lists", () => {
  assert.deepEqual(parseUnitIds(`${ID}, ${ID}`), [ID, ID]);
  assert.equal(parseUnitIds("1,2"), null);
  assert.equal(parseUnitIds(""), null);
  assert.equal(parseUnitIds(`${ID};drop table`), null);
});

test("describeUnit reports the furthest real stage", () => {
  const unit = (over) => ({ id: ID, source_url: "u", status: "ready", artifacts: [], exclusions: [], ...over });
  const art = (over) => ({ ingestion_status: "ready", video: null, ...over });

  assert.equal(describeUnit(unit({ status: "pending" })).stage, "queued");
  assert.equal(describeUnit(unit({ status: "running" })).stage, "fetching");
  assert.deepEqual(
    [describeUnit(unit({ status: "failed", error: null })).stage, describeUnit(unit({ status: "failed", error: null })).error],
    ["failed", null]
  );
  assert.equal(describeUnit(unit({})).stage, "digesting");
  assert.equal(describeUnit(unit({ exclusions: ["Off topic."] })).stage, "not_selected");
  assert.equal(describeUnit(unit({ artifacts: [art({})] })).stage, "rendering");
  assert.equal(describeUnit(unit({ artifacts: [art({ video: { status: "failed", error: "ffmpeg exit 1" } })] })).error, "ffmpeg exit 1");
  const retrying = describeUnit(unit({ artifacts: [art({ video: { status: "failed", error: "Gemini HTTP 503", attempts: 1 } })] }));
  assert.deepEqual([retrying.stage, retrying.settled, retrying.error], ["render_retrying", false, "Gemini HTTP 503"]);
  assert.equal(describeUnit(unit({ artifacts: [art({ video: { status: "failed", error: "x", attempts: 3 } })] })).stage, "render_failed");
  for (const artifactReview of [undefined, "pending", "approved", "rejected"]) {
    for (const videoReview of [undefined, "pending", "approved", "rejected"]) {
      const result = describeUnit(unit({ artifacts: [art({
        review_status: artifactReview, video: { status: "ready", review_status: videoReview },
      })] }));
      assert.equal(result.stage, "ready");
      assert.equal(result.settled, true);
    }
  }
  assert.equal(describeUnit(unit({ artifacts: [art({
    ingestion_status: "running", video: { status: "ready" },
  })] })).stage, "digesting");
  assert.equal(describeUnit(unit({ artifacts: [art({ video: { status: "running" } })] })).stage, "rendering");
  const ready = describeUnit(unit({ artifacts: [
    art({ ingestion_status: "failed" }),
    art({ video: { status: "ready" } }),
  ] }));
  assert.equal(ready.stage, "ready");
  assert.equal(ready.settled, true);
});

test("media refs resolve only to safe same-origin keys or https", () => {
  assert.equal(resolveMediaRef("r2:videos/a1/1/short.mp4"), "/media/videos/a1/1/short.mp4");
  assert.equal(resolveMediaRef("r2:captions/a1/1/short.vtt"), "/media/captions/a1/1/short.vtt");
  assert.equal(resolveMediaRef("https://cdn.example.com/a.mp4"), "https://cdn.example.com/a.mp4");
  for (const ref of ["r2:../secrets", "r2:videos/../x", "r2:other/a.mp4", "file:///tmp/a.mp4", "/tmp/a.mp4", "http://x/a.mp4", null]) {
    assert.equal(resolveMediaRef(ref), null, String(ref));
  }
  assert.equal(isMediaKey("videos/a/../b.mp4"), false);
});

test("parseRange handles the ranges video players send", () => {
  assert.deepEqual(parseRange("bytes=0-1", 100), { offset: 0, length: 2 });
  assert.deepEqual(parseRange("bytes=10-", 100), { offset: 10, length: 90 });
  assert.deepEqual(parseRange("bytes=-20", 100), { offset: 80, length: 20 });
  assert.deepEqual(parseRange("bytes=90-500", 100), { offset: 90, length: 10 });
  assert.equal(parseRange("bytes=100-", 100), "unsatisfiable");
  assert.equal(parseRange(null, 100), null);
  assert.equal(parseRange("bytes=0-1,5-9", 100), null);
  assert.equal(parseRange("bytes=9-2", 100), null);
});

test("serializeItem drops clips it can't serve and normalises numbers", () => {
  const row = {
    id: ID, version: 1, name: "Write the check first", category: null, source_url: "https://www.youtube.com/watch?v=VQy50fuxI34",
    sources: null, selection_reason: null, video_id: ID, media_ref: "r2:videos/x/1/short.mp4", caption_ref: null,
    duration_seconds: "34.20", feed_order: null, skill_id: null,
  };
  const item = serializeItem(row);
  assert.equal(item.video.url, "/media/videos/x/1/short.mp4");
  assert.equal(item.video.duration_seconds, 34.2);
  assert.equal(item.video.captions_url, null);
  assert.equal(item.skill, null);
  assert.deepEqual(item.sources, []);
  assert.equal(serializeItem({ ...row, media_ref: "/var/render/out.mp4" }), null);
});

test("requestProcessing reports what actually happened", async () => {
  const ok = async () => new Response(null, { status: 202 });
  const down = async () => new Response(null, { status: 500 });
  const boom = async () => { throw new Error("ECONNREFUSED"); };
  let sent;
  const spy = async (url, init) => ((sent = { url, init }), new Response(null, { status: 202 }));

  assert.equal(await requestProcessing({}, [ID], ok), "not_configured");
  assert.equal(await requestProcessing({ PROCESSOR_URL: "https://p.dev/process" }, [], ok), "not_needed");
  assert.equal(await requestProcessing({ PROCESSOR_URL: "https://p.dev/process" }, [ID], down), "unavailable");
  assert.equal(await requestProcessing({ PROCESSOR_URL: "https://p.dev/process" }, [ID], boom), "unavailable");
  assert.equal(await requestProcessing({ PROCESSOR_URL: "https://p.dev/process", PROCESSOR_TOKEN: "t" }, [ID], spy), "requested");
  assert.equal(sent.init.headers.authorization, "Bearer t");
  assert.deepEqual(JSON.parse(sent.init.body), { unit_ids: [ID] });
});


test("final progress is read before the feed so a just-rendered clip is not missed", async (t) => {
  const calls = [];
  let release;
  const progress = new Promise((resolve) => { release = resolve; });
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url === "/api/imports") {
      await progress;
      return Response.json({ units: [{ stage: "ready", settled: true }] });
    }
    return Response.json({ items: [] });
  });
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  followImports({ onUnits: () => {}, onItems: done, onError: done });
  try {
    assert.deepEqual(calls, ["/api/imports"]);
  } finally {
    release();
    await finished;
  }
  assert.deepEqual(calls, ["/api/imports", "/api/feed?scope=mine"]);
});

test("canonicalises X post links and rejects X links that aren't a post", () => {
  for (const input of [
    "https://x.com/someone/status/1850000000000000001?s=20",
    "https://twitter.com/someone/status/1850000000000000001",
    "x.com/i/web/status/1850000000000000001",
  ]) {
    const r = parseXLink(input);
    assert.equal(r.ok, true, input);
    assert.deepEqual(r.value, { submitted_url: input, source_url: "https://x.com/i/status/1850000000000000001", start_seconds: null, content_type: "x_post" });
  }
  for (const input of ["https://x.com/someone", "https://x.com/i/bookmarks", "https://x.com.evil.dev/a/status/1"]) {
    assert.equal(parseXLink(input).ok, false, input);
  }
});

test("parseImport accepts YouTube and X links together and de-duplicates X posts", () => {
  const r = parseImport({ links: "https://youtu.be/VQy50fuxI34 https://x.com/a/status/12 https://twitter.com/b/status/12" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.links.map((l) => l.source_url), ["https://www.youtube.com/watch?v=VQy50fuxI34", "https://x.com/i/status/12"]);

  const bad = parseImport({ links: ["https://x.com/a/status/12", "https://x.com/a"] });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.invalid.map((i) => i.link), ["https://x.com/a"]);
});

test("parseImport caps 20 YouTube videos and 100 X posts independently", () => {
  const yt = (n) => Array.from({ length: n }, (_, i) => `https://www.youtube.com/watch?v=${String(i).padStart(11, "a")}`);
  const xs = (n) => Array.from({ length: n }, (_, i) => `https://x.com/a/status/${i + 1}`);
  assert.equal(parseImport({ links: [...yt(20), ...xs(100)] }).ok, true);
  assert.match(parseImport({ links: yt(21) }).error, /at most 20 YouTube/);
  assert.match(parseImport({ links: xs(101) }).error, /at most 100 X posts/);
  assert.equal(parseImport({ links: [...yt(20), ...xs(101)] }).ok, false);
});

test("requestProcessing sends large imports in batches of 10", async () => {
  const sent = [];
  const fetchImpl = async (_url, init) => (sent.push(JSON.parse(init.body).unit_ids.length), { ok: true });
  const ids = Array.from({ length: 25 }, (_, i) => `id${i}`);
  assert.equal(await requestProcessing({ PROCESSOR_URL: "http://p" }, ids, fetchImpl), "requested");
  assert.deepEqual(sent, [10, 10, 5]);
  const failing = async (_u, init) => ({ ok: JSON.parse(init.body).unit_ids[0] !== "id10" });
  assert.equal(await requestProcessing({ PROCESSOR_URL: "http://p" }, ids, failing), "unavailable");
});

test("a unit held back by the processing limit says when it starts, and counts as settled until then", () => {
  const now = new Date("2026-10-11T20:00:00Z");
  const row = { id: ID, source_url: "https://www.youtube.com/watch?v=VQy50fuxI34", start_seconds: null, title: null, status: "pending", error: null };
  const held = describeUnit({ ...row, deferred_until: "2026-10-12T00:00:00Z" }, now);
  assert.equal(held.stage, "limited");
  assert.equal(held.settled, true);
  assert.match(held.error, /processing limit .* starts after 2026-10-12 00:00 UTC\./);
  assert.equal(describeUnit({ ...row, deferred_until: "2026-10-11T00:00:00Z" }, now).stage, "queued", "past the time, it's just queued");
  assert.equal(describeUnit({ ...row, deferred_until: null }, now).stage, "queued");
  // Already read, waiting for room to be digested again.
  const ready = { ...row, status: "ready", exclusions: [], artifacts: [] };
  assert.equal(describeUnit({ ...ready, deferred_until: "2026-10-12T00:00:00Z" }, now).stage, "limited");
  assert.equal(describeUnit({ ...ready, deferred_until: null }, now).stage, "digesting");
});

test("canonicalises Substack post links and rejects non-posts", async () => {
  const { parseSubstackLink } = await import("../src/substack.js");
  for (const input of [
    "https://newsletter.substack.com/p/evals-first?utm_source=share&r=1#comments",
    "newsletter.substack.com/p/evals-first",
    "https://open.substack.com/pub/newsletter/p/evals-first?r=2",
  ]) {
    const r = parseSubstackLink(input);
    assert.equal(r.ok, true, input);
    assert.deepEqual(r.value, { submitted_url: input, source_url: "https://newsletter.substack.com/p/evals-first", start_seconds: null, content_type: "substack_post" });
  }
  for (const input of ["https://newsletter.substack.com/", "https://newsletter.substack.com/archive", "https://substack.com/@someone", "https://www.substack.com/p/x", "not a link"]) {
    assert.equal(parseSubstackLink(input).ok, false, input);
  }
});

test("parseImport accepts YouTube and Substack together and de-duplicates posts", () => {
  const r = parseImport({ links: "https://youtu.be/VQy50fuxI34\nhttps://a.substack.com/p/x?r=1\nhttps://a.substack.com/p/x#c" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.links.map((l) => [l.content_type ?? "youtube_video", l.source_url]), [
    ["youtube_video", "https://www.youtube.com/watch?v=VQy50fuxI34"],
    ["substack_post", "https://a.substack.com/p/x"],
  ]);
  const bad = parseImport({ links: ["https://a.substack.com/", "https://vimeo.com/1"] });
  assert.equal(bad.ok, false);
  assert.equal(bad.invalid.length, 2);
});

test("parseImport caps Substack posts at 20 independently of videos and X posts", () => {
  const posts = (n) => Array.from({ length: n }, (_, i) => `https://pub.substack.com/p/post-${i}`);
  const yt = Array.from({ length: 20 }, (_, i) => `https://www.youtube.com/watch?v=${String(i).padStart(11, "a")}`);
  assert.equal(parseImport({ links: [...yt, ...posts(20)] }).ok, true);
  assert.match(parseImport({ links: posts(21) }).error, /at most 20 Substack/);
});
