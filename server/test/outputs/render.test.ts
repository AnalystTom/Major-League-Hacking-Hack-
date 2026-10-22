// Runs the real ffmpeg render with tone narration in place of TTS. Skipped when ffmpeg isn't installed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fontFile, probe } from "../../src/outputs/render/ffmpeg.js";
import type { MediaStore } from "../../src/outputs/render/media.js";
import { renderArtifact } from "../../src/outputs/render/render.js";
import { artifact, outputsFetch } from "./helpers.js";

// These cover the plain ffmpeg renderer; motion-skill.test.ts covers the motion-graphic-skill path.
process.env.RENDER_STYLE = "basic";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); execFileSync("ffprobe", ["-version"]); return true; } catch { return false; } })();

class DirMedia implements MediaStore {
  keys: string[] = [];
  constructor(public dir: string) {}
  async put(key: string, file: string) {
    this.keys.push(key);
    await copyFile(file, join(this.dir, key.replace(/\//g, "_")));
    return `r2:${key}`;
  }
}

test("renders a 1080x1920 H.264/AAC short with captions timed to the narration", { skip: !hasFfmpeg && "ffmpeg not installed", timeout: 120_000 }, async () => {
  const out = await mkdtemp(join(tmpdir(), "resurface-render-test-"));
  try {
    const a = artifact();
    const { impl, calls } = outputsFetch(a);
    const media = new DirMedia(out);
    const previous = join(out, `videos_${a.id}_1_short.mp4`);
    await writeFile(previous, "previous approved video");
    const v = await renderArtifact(a, { openaiKey: "o", geminiKey: "g", media, fetchImpl: impl });

    assert.equal(calls.script, 1);
    assert.equal(calls.judge, 1);
    assert.equal(v.judgment.passed, true);
    assert.equal(calls.tts, 4, "one narration clip per scene");
    assert.deepEqual(media.keys, [v.media_ref, v.caption_ref, v.narration_ref].map(ref => ref.slice(3)));
    assert.notEqual(v.media_ref, `r2:videos/${a.id}/1/short.mp4`);
    assert.equal(await readFile(previous, "utf8"), "previous approved video", "a replacement cannot overwrite published bytes");

    const p = await probe(join(out, media.keys[0].replace(/\//g, "_")));
    assert.deepEqual(p.video, { codec: "h264", width: 1080, height: 1920 });
    assert.equal(p.audio?.codec, "aac");
    assert.ok(Math.abs(p.duration - v.duration_seconds) < 0.05);

    const scenes = v.script.scenes;
    assert.equal(scenes[0].start_seconds, 0);
    for (let i = 1; i < scenes.length; i++) assert.equal(scenes[i].start_seconds, scenes[i - 1].end_seconds);
    assert.ok(Math.abs(scenes.at(-1)!.end_seconds - v.duration_seconds) < 0.1, "the timeline fills the measured video");

    const vtt = await readFile(join(out, media.keys[1].replace(/\//g, "_")), "utf8");
    assert.match(vtt, /^WEBVTT/);
    assert.match(vtt, /Your coding agent says it's/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("a TTS failure fails the render with the provider's status", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const a = artifact();
  const { impl } = outputsFetch(a, { ttsStatus: 403 });
  await assert.rejects(renderArtifact(a, { openaiKey: "o", geminiKey: "g", media: new DirMedia(tmpdir()), fetchImpl: impl }), /TTS HTTP 403/);
});

test("a RENDER_FONT path with ':' or quotes still renders", { skip: !hasFfmpeg && "ffmpeg not installed", timeout: 120_000 }, async () => {
  const font = fontFile(undefined);
  if (!font) return; // no bold system font to copy on this host
  const out = await mkdtemp(join(tmpdir(), "resurface-font-test-"));
  const awkward = join(out, "odd: name's.ttf");
  await copyFile(font, awkward);
  const before = process.env.RENDER_FONT;
  process.env.RENDER_FONT = awkward;
  try {
    const a = artifact();
    const v = await renderArtifact(a, { openaiKey: "o", geminiKey: "g", media: new DirMedia(out), fetchImpl: outputsFetch(a).impl });
    assert.ok(v.duration_seconds > 0);
  } finally {
    if (before === undefined) delete process.env.RENDER_FONT;
    else process.env.RENDER_FONT = before;
    await rm(out, { recursive: true, force: true });
  }
});

test("a rejected or malformed quality judgment uploads nothing", { skip: !hasFfmpeg && "ffmpeg not installed", timeout: 120_000 }, async () => {
  const a = artifact(), media = new DirMedia(tmpdir());
  const result = { scores: { grounding: 2, clarity: 4, usefulness: 4, visuals: 4, subtitles: 4, caption_overlap: 4 }, reasons: ["The narration invents a result."] };
  const { impl, calls } = outputsFetch(a, { judge: result });
  await assert.rejects(renderArtifact(a, { openaiKey: "o", geminiKey: "g", media, fetchImpl: impl }), /Quality judge rejected:.*invents a result/);
  assert.equal(calls.judge, 1, "one independent judging pass");
  assert.deepEqual(media.keys, [], "rejected clips never reach publication storage");
  const overlap = outputsFetch(a, { judge: { scores: { grounding: 5, clarity: 5, usefulness: 5, visuals: 5, subtitles: 5, caption_overlap: 3 }, reasons: [] } });
  await assert.rejects(renderArtifact(a, { openaiKey: "o", geminiKey: "g", media, fetchImpl: overlap.impl }), /Quality judge rejected:.*caption_overlap scored 3/);
  assert.equal(overlap.calls.judge, 1);
  assert.deepEqual(media.keys, [], "an otherwise excellent clip with caption overlap is withheld");
});

test("an unavailable model fails before narration, rendering or upload", async () => {
  const a = artifact(), media = new DirMedia(tmpdir());
  let calls = 0;
  await assert.rejects(renderArtifact(a, { openaiKey: "o", geminiKey: "g", media, fetchImpl: async (_url, init) => {
    calls++;
    assert.equal(JSON.parse(String(init?.body)).model, "gpt-6.1-sol");
    return Response.json({ error: { message: "Model gpt-6.1-sol is unavailable", code: "model_not_found" } }, { status: 404 });
  } }), /OpenAI.*404.*gpt-6.1-sol/);
  assert.equal(calls, 1);
  assert.deepEqual(media.keys, []);
});
