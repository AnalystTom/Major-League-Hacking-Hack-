// The motion renderer: validation of the model's FILM program, beat timing, the text fallback, and (when a Chromium is
// available through CHROMIUM_PATH) a real frame-exact render.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe } from "../../src/outputs/render/ffmpeg.js";
import type { MediaStore } from "../../src/outputs/render/media.js";
import { checkFilm, motionSlots, validateMotion } from "../../src/outputs/render/motion.js";
import { renderArtifact } from "../../src/outputs/render/render.js";
import { artifact, outputsFetch, toneWav } from "./helpers.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();
const chromiumPath = process.env.CHROMIUM_PATH;

const FILM = `window.FILM = {
  bg: ["ink", "hot", "cream", "blue", "ink"],
  chapters: ["Hook", "Fix", "Run", "Show", "Next"],
  draw: [0, 1, 2, 3, 4].map((i) => (ctx, s, dur) => {
    E.headline(ctx, [[{ t: "STEP" }], [{ t: "number " + (i + 1) + ".", serif: true, color: E.P.amber }]], { y: 330, size: 170, color: E.P.paper, s });
    K.robot(ctx, 540, 1100 - 40 * M.spring(s), 1.5, { color: E.P.blue, bob: s * 6 });
    K.star(ctx, 300 + 480 * M.ease.inOutCubic(s / dur), 800, 60, s * 3, E.P.amber);
  }),
  cues: [[0, 0.05, "thud"], [1, 0, "whoosh"], [4, 0.5, "chime"], [9, 0, "pop"], [0, 1, "nope"]],
};`;

export const motionReply = (a: ReturnType<typeof artifact>, film = FILM) => ({
  logline: "A failing check makes done mean done.",
  beats: [
    { narration_text: "Your agent says it's done. Did anything actually check?", visual: "robot shrugs", source_ids: [] },
    { narration_text: "Write the failing check before the agent starts.", visual: "red check", source_ids: [a.source_ids[0]] },
    { narration_text: "Now success means a red test turning green.", visual: "red to green", source_ids: [a.source_ids[0]] },
    { narration_text: "The agent has to run it and show you the result.", visual: "terminal", source_ids: [a.source_ids[0]] },
    { narration_text: "Next handoff: write the check first.", visual: "check first", source_ids: [] },
  ],
  film,
});

test("validateMotion accepts a grounded FILM and rejects what it must not run", () => {
  const a = artifact();
  assert.equal(validateMotion(motionReply(a), a).beats.length, 5);
  assert.throws(() => validateMotion(motionReply(a, FILM.replace("M.spring(s)", "Math.random()")), a), /forbidden construct: Math\.random/);
  assert.throws(() => checkFilm(`window.FILM = { draw: [() => fetch("https://evil.example")] };`), /forbidden construct/);
  assert.throws(() => checkFilm(`window.FILM = { x: ({}).constructor.constructor("return 1") };`), /forbidden construct: constructor/);
  assert.throws(() => checkFilm(`const film = 1;`), /doesn't assign window\.FILM/);
  const bad = motionReply(a); bad.beats[1].source_ids = ["not-a-source"];
  assert.throws(() => validateMotion(bad, a), /cites not-a-source/);
  const few = motionReply(a); few.beats = few.beats.slice(0, 3);
  assert.throws(() => validateMotion(few, a));
});

test("motionSlots splits one narration take by word share and fills it exactly", () => {
  const slots = motionSlots(["one two", "three four five six", "seven eight"], 8);
  assert.equal(slots[0].start, 0);
  assert.equal(slots[1].start, slots[0].end);
  assert.equal(slots.at(-1)!.end, 8);
  assert.ok(slots[1].end - slots[1].start > slots[0].end - slots[0].start, "more words, more time");
});

class DirMedia implements MediaStore {
  keys: string[] = [];
  constructor(public dir: string) {}
  async put(key: string, file: string) { this.keys.push(key); await copyFile(file, join(this.dir, key.replace(/\//g, "_"))); return `r2:${key}`; }
}

test("a motion render that fails falls back to the text renderer and says why", { skip: !hasFfmpeg && "ffmpeg not installed", timeout: 120_000 }, async () => {
  const out = await mkdtemp(join(tmpdir(), "resurface-motion-fallback-"));
  try {
    const a = artifact();
    const { impl } = outputsFetch(a); // answers the motion brief with a skill-shaped reply, which fails validation
    const v = await renderArtifact(a, { openaiKey: "o", geminiKey: "g", media: new DirMedia(out), fetchImpl: impl, renderStyle: "motion" });
    assert.match(v.prompt_revision, /^script-v1; .*motion fell back: /);
    assert.equal((await probe(join(out, `videos_${a.id}_1_short.mp4`))).video?.width, 1080);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("renders a FILM frame by frame into a 1080x1920 short with narration, effects and captions",
  { skip: (!hasFfmpeg || !chromiumPath) && "needs ffmpeg and CHROMIUM_PATH", timeout: 300_000 }, async () => {
    const out = await mkdtemp(join(tmpdir(), "resurface-motion-test-"));
    try {
      const a = artifact();
      const calls = { motion: 0, tts: 0 };
      const impl = (async (url: string, init?: { body?: string }) => {
        if (String(url).includes("openai")) {
          calls.motion++;
          const reply = calls.motion === 1 ? motionReply(a) : { scores: [7, 7, 7, 7, 7], worst: ["x"], film: FILM };
          return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
        }
        calls.tts++;
        const text: string = JSON.parse(init!.body!).input[0].content[0].text;
        return Response.json({ steps: [{ type: "model_output", content: [{ type: "audio", data: toneWav(text.split(/\s+/).length / 3).toString("base64") }] }] });
      }) as unknown as typeof fetch;
      const media = new DirMedia(out);
      const v = await renderArtifact(a, { openaiKey: "o", geminiKey: "g", media, fetchImpl: impl, renderStyle: "motion", chromiumPath });
      assert.match(v.prompt_revision, /^motion-v1; .*critique:7\/7\/7\/7\/7$/);
      assert.equal(calls.motion, 2, "draft, then one critique pass");
      assert.equal(calls.tts, 1, "one narration take for the whole short");
      assert.deepEqual(media.keys, [`videos/${a.id}/1/short.mp4`, `captions/${a.id}/1/short.vtt`, `audio/${a.id}/1/narration.m4a`]);
      const p = await probe(join(out, `videos_${a.id}_1_short.mp4`));
      assert.deepEqual(p.video, { codec: "h264", width: 1080, height: 1920 });
      assert.equal(p.audio?.codec, "aac");
      assert.equal(v.script.scenes.length, 5);
      assert.ok(Math.abs(v.script.scenes.at(-1)!.end_seconds - v.duration_seconds) < 0.1);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

test("a FILM that never returns times out and the short falls back to text",
  { skip: (!hasFfmpeg || !chromiumPath) && "needs ffmpeg and CHROMIUM_PATH", timeout: 300_000 }, async () => {
    const out = await mkdtemp(join(tmpdir(), "resurface-motion-hang-"));
    try {
      const a = artifact();
      const hang = FILM.replace("K.robot(", "for (;;) {} K.robot(");
      const { impl: textImpl } = outputsFetch(a);
      const impl = (async (url: string, init?: { body?: string }) => {
        if (String(url).includes("openai") && JSON.parse(init!.body!).messages[0].content.includes("motion designer")) {
          return Response.json({ choices: [{ message: { content: JSON.stringify(motionReply(a, hang)) } }] });
        }
        return textImpl(url, init as RequestInit);
      }) as unknown as typeof fetch;
      const v = await renderArtifact(a, { openaiKey: "o", geminiKey: "g", media: new DirMedia(out), fetchImpl: impl, renderStyle: "motion", chromiumPath });
      assert.match(v.prompt_revision, /motion fell back: .*took longer than 5s/);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
