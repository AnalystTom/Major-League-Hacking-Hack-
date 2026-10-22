import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe } from "../../src/outputs/render/ffmpeg.js";
import type { MediaStore } from "../../src/outputs/render/media.js";
import { renderArtifact } from "../../src/outputs/render/render.js";
import { fillTemplate, motionSpec, recordEnv } from "../../src/outputs/render/motion-skill.js";
import { MemoryOutputStore, skillCardOf } from "../../src/outputs/store.js";
import { JUDGE_SYSTEM_PROMPT } from "../../src/outputs/render/judge.js";
import { SCRIPT_SYSTEM_PROMPT } from "../../src/outputs/render/script.js";
import { SCENE_GAP_SECONDS } from "../../src/outputs/render/timeline.js";
import { artifact, outputsFetch, scriptReply, toneWav } from "./helpers.js";

const slots = [{ start: 0, speechEnd: 5.4, end: 5.75 }, { start: 5.75, speechEnd: 13, end: 13.35 }, { start: 13.35, speechEnd: 20, end: 20.35 }];
const scenes = [
  { on_screen_text: "Agents claim success", narration_text: "Your coding agent says it's done. It often isn't." },
  { on_screen_text: "Write the failing check", narration_text: "Write the check first, then let the agent work." },
  { on_screen_text: "Make done provable", narration_text: "Next: add one failing check before your next agent task." },
];

test("the spec times each scene to its narration slot and ends on the ready skill", () => {
  const spec = motionSpec(artifact(), scenes, slots, { name: "write-the-check-first", description: "Write a failing check before starting an agent task." });
  assert.deepEqual(spec.scenes.map((s) => [s.code, s.d]), [["SAVED", 5.75], ["LESSON", 7.6], ["SKILL", 7]]);
  assert.equal(spec.scenes[0].sub, "Your coding agent says it's done.");
  assert.equal(spec.scenes[2].sub, "", "the skill card shows the skill, not an aside");
  assert.equal(spec.scenes[2].theme, "paper");
  assert.deepEqual(spec.skill, { name: "write-the-check-first", description: "Write a failing check before starting an agent task." });
  assert.deepEqual(spec.source, { kind: "youtube", platform: "YouTube", title: "Evals for coding agents", byline: "", tag: "YOUTUBE" });
});

test("without a ready skill the end card has no skill metadata to show", () => {
  assert.equal(motionSpec(artifact(), scenes, slots, null).skill, null);
});

test("an X post's handle becomes the byline, and several sources are counted in the tag", () => {
  const a = artifact({ sources: [
    { url: "https://x.com/i/status/2108692010056188048", title: "@cognition: You can use any personal ChatGPT plan with Devin" },
    { url: "https://www.youtube.com/watch?v=VQy50fuxI34", title: "Evals" },
  ] });
  assert.deepEqual(motionSpec(a, scenes, slots, null).source,
    { kind: "x", platform: "X", title: "You can use any personal ChatGPT plan with Devin", byline: "@cognition", tag: "X · 2 SOURCES" });
});

test("source text can't close the template's script tag", async () => {
  const template = await readFile(new URL("../../assets/motion-graphic-skill/resurface-short.html", import.meta.url), "utf8");
  const a = artifact({ sources: [{ url: "https://www.youtube.com/watch?v=VQy50fuxI34", title: "</script><script>alert(1)</script> " }] });
  const html = fillTemplate(template, motionSpec(a, scenes, slots, null));
  assert.ok(!html.includes("/*DATA*/null"));
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(!html.includes(" "));
  assert.throws(() => fillTemplate("<script>const DATA = 1;</script>", motionSpec(a, scenes, slots, null)), /no DATA placeholder/);
});

test("the end card reads only the real name and description from SKILL.md", async () => {
  const card = { name: "write-the-check-first", description: 'Write a "failing" check.' };
  assert.deepEqual(skillCardOf('---\nname: write-the-check-first\ndescription: "Write a \\"failing\\" check."\n---\n\nbody'), card);
  assert.equal(skillCardOf("no frontmatter"), null);
  assert.equal(skillCardOf('---\nname: write-the-check-first\n---\n'), null);
  assert.equal(skillCardOf('---\nname: write-the-check-first\ndescription: "broken\n---\n'), null);
  const store = new MemoryOutputStore(0), a = artifact();
  store.artifacts.push(a);
  assert.deepEqual(await store.skillCard(a), { status: "none", card: null });
  const c = (await store.claim("skill", a))!;
  assert.deepEqual(await store.skillCard(a), { status: "running", card: null });
  await store.finishSkill(c, { skill_markdown: '---\nname: write-the-check-first\ndescription: "Write a \\"failing\\" check."\n---\n', supporting_refs: [], action_items: [] });
  assert.deepEqual(await store.skillCard(a), { status: "ready", card });
});

test("text that's too long is cut at a word, and an X post cut at ingest says so", () => {
  const long = "Cognition reports that connecting a personal ChatGPT Go, Plus, or Pro plan to Devin makes Devin's GPT model usage draw from that plan's quota.";
  const spec = motionSpec(artifact({ sources: [{ url: "https://x.com/i/status/1", title: `@cognition: ${long.slice(0, 80)}` }] }),
    [{ on_screen_text: "Plan quota", narration_text: long }, ...scenes.slice(1)], slots, null);
  assert.equal(spec.scenes[0].sub, "Cognition reports that connecting a personal ChatGPT Go, Plus, or Pro plan to Devin makes Devin's GPT model usage draw from that plan's…");
  assert.equal(spec.source.title, "Cognition reports that connecting a personal ChatGPT Go, Plus, or Pro plan to…");
});

// The default renderer end to end: tone narration, real record.js in headless Chromium, the music mix. Skipped
// without ffmpeg or a Chrome/Chromium (CHROME, or one of the places record.js looks).
const chrome = process.env.CHROME ?? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"].find((p) => existsSync(p));
const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();

test("renders a motion short with the narration over the engine's music", { skip: !(chrome && hasFfmpeg) && "needs ffmpeg and Chrome", timeout: 600_000 }, async () => {
  const out = await mkdtemp(join(tmpdir(), "resurface-motion-test-"));
  try {
    const a = artifact();
    const keys: string[] = [];
    const media: MediaStore = { put: async (key, file) => { keys.push(key); await copyFile(file, join(out, key.replace(/\//g, "_"))); return `r2:${key}`; } };
    const card = { name: "write-the-check-first", description: "Write a failing check before starting an agent task." };
    const { impl } = outputsFetch(a);
    let judged = false;
    let endCardFrame: Buffer | undefined;
    const closingSpeechSeconds = 0.8;
    const fetchImpl: typeof fetch = async (url, init) => {
      const request = JSON.parse(String(init?.body));
      if (request.messages?.[0]?.content === SCRIPT_SYSTEM_PROMPT) {
        const script = scriptReply(a);
        script.scenes.at(-1)!.narration_text = "Check first.";
        return Response.json({ choices: [{ message: { content: JSON.stringify(script) } }] });
      }
      if (request.input?.[0]?.content?.[0]?.text === "Check first.") {
        return Response.json({ steps: [{ type: "model_output", content: [{ type: "audio", data: toneWav(closingSpeechSeconds).toString("base64") }] }] });
      }
      if (request.messages?.[0]?.content === JUDGE_SYSTEM_PROMPT) {
        const evidence = JSON.parse(request.messages[1].content[0].text);
        assert.deepEqual(evidence.generated_skill, card);
        assert.deepEqual(evidence.verification_report.failures, [], "the skill's own full check ran before judging");
        assert.ok(evidence.verification_report.langs.en.audio.startsWith("peak="));
        assert.equal(Object.keys(evidence.verification_report.langs.en.layout).length, 7);
        assert.ok(evidence.scenes.every((s: { source_ids: string[] }) => s.source_ids.length > 0));
        const images = request.messages[1].content.filter((c: { type: string }) => c.type === "image_url");
        endCardFrame = Buffer.from(images.at(-1).image_url.url.split(",")[1], "base64");
        judged = true;
      }
      return impl(url, init);
    };
    const v = await renderArtifact(a, { openaiKey: "o", geminiKey: "g", media, fetchImpl,
      skillCard: async () => ({ status: "ready", card }) });
    assert.ok(judged, "the rendered skill is supplied as judge evidence");
    assert.match(v.prompt_revision, /; visuals:motion-graphic-skill$/);
    assert.match(v.music_provenance ?? "", /Web Audio/);
    assert.deepEqual(keys, [v.media_ref, v.caption_ref, v.narration_ref].map(ref => ref.slice(3)));
    const video = join(out, keys[0].replace(/\//g, "_"));
    const p = await probe(video);
    assert.deepEqual(p.video, { codec: "h264", width: 1080, height: 1920 });
    assert.equal(p.audio?.codec, "aac");
    assert.ok(Math.abs(p.duration - v.script.scenes.at(-1)!.end_seconds) < 0.5, "the film is as long as the narrated timeline");
    const last = v.script.scenes.at(-1)!;
    assert.equal(last.narration_text, "Check first.");
    assert.ok(Math.abs(last.end_seconds - last.start_seconds - 2.5) < 0.001);
    const narrationDuration = (await probe(join(out, keys[2].replace(/\//g, "_")))).duration;
    const [frameRate, frameBase] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
      "-of", "default=noprint_wrappers=1:nokey=1", video], { encoding: "utf8" }).trim().split("/").map(Number);
    const frameSeconds = frameBase / frameRate;
    assert.ok(Number.isFinite(frameSeconds) && frameSeconds > 0);
    const closingExtension = last.end_seconds - last.start_seconds - closingSpeechSeconds - SCENE_GAP_SECONDS;
    assert.ok(p.duration >= narrationDuration, `film ${p.duration}s must not clip ${narrationDuration}s narration`);
    assert.ok(p.duration - narrationDuration <= closingExtension + frameSeconds,
      "the film may outlast narration only by the closing extension and one render frame");
    const frameAt = (time: number) => execFileSync("ffmpeg", ["-v", "error", "-ss", String(time), "-i", video, "-frames:v", "1", "-vf", "scale=390:694", "-pix_fmt", "yuvj420p", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"]);
    const cardPixels = (jpeg: Buffer) => execFileSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", "crop=320:208:32:128", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { input: jpeg });
    const settled = cardPixels(frameAt(last.end_seconds - 0.2));
    assert.notDeepEqual(cardPixels(frameAt(last.start_seconds + 1)), settled, "one second misses the delayed skill description");
    assert.ok(endCardFrame);
    const sampled = cardPixels(endCardFrame);
    const difference = sampled.reduce((sum, value, i) => sum + Math.abs(value - settled[i]), 0) / sampled.length;
    assert.ok(difference < 0.5, "the judge sees the settled actual skill name and description");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("Chromium never sees the processor's keys", () => {
  const env = recordEnv({ PATH: "/usr/bin", HOME: "/home/node", CHROME: "/c", OPENAI_API_KEY: "sk-x", GEMINI_API_KEY: "g", DATABASE_URL: "postgres://u:p@h/db",
    R2_SECRET_ACCESS_KEY: "r", INGEST_TOKEN: "t", TWITTERAPI_IO_KEY: "k" });
  assert.deepEqual(env, { PATH: "/usr/bin", HOME: "/home/node", CHROME: "/c" });
});
