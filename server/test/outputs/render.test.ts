// Runs the real ffmpeg render with tone narration in place of TTS. Skipped when ffmpeg isn't installed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe } from "../../src/outputs/render/ffmpeg.js";
import type { MediaStore } from "../../src/outputs/render/media.js";
import { renderArtifact } from "../../src/outputs/render/render.js";
import { artifact, outputsFetch } from "./helpers.js";

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
    const v = await renderArtifact(a, { openaiKey: "o", geminiKey: "g", media, fetchImpl: impl });

    assert.equal(calls.script, 1);
    assert.equal(calls.tts, 4, "one narration clip per scene");
    assert.deepEqual(media.keys, [`videos/${a.id}/1/short.mp4`, `captions/${a.id}/1/short.vtt`, `audio/${a.id}/1/narration.m4a`]);
    assert.equal(v.media_ref, `r2:videos/${a.id}/1/short.mp4`);

    const p = await probe(join(out, `videos_${a.id}_1_short.mp4`));
    assert.deepEqual(p.video, { codec: "h264", width: 1080, height: 1920 });
    assert.equal(p.audio?.codec, "aac");
    assert.ok(Math.abs(p.duration - v.duration_seconds) < 0.05);

    const scenes = v.script.scenes;
    assert.equal(scenes[0].start_seconds, 0);
    for (let i = 1; i < scenes.length; i++) assert.equal(scenes[i].start_seconds, scenes[i - 1].end_seconds);
    assert.ok(Math.abs(scenes.at(-1)!.end_seconds - v.duration_seconds) < 0.1, "the timeline fills the measured video");

    const vtt = await readFile(join(out, `captions_${a.id}_1_short.vtt`), "utf8");
    assert.match(vtt, /^WEBVTT/);
    assert.match(vtt, /Your coding agent says it's done/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("a TTS failure fails the render with the provider's status", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const a = artifact();
  const { impl } = outputsFetch(a, { ttsStatus: 403 });
  await assert.rejects(renderArtifact(a, { openaiKey: "o", geminiKey: "g", media: new DirMedia(tmpdir()), fetchImpl: impl }), /TTS HTTP 403/);
});
