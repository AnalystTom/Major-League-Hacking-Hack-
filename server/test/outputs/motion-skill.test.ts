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
import { MemoryOutputStore, skillNameOf } from "../../src/outputs/store.js";
import { artifact, outputsFetch } from "./helpers.js";

const slots = [{ start: 0, speechEnd: 5.4, end: 5.75 }, { start: 5.75, speechEnd: 13, end: 13.35 }, { start: 13.35, speechEnd: 20, end: 20.35 }];
const scenes = [
  { on_screen_text: "Agents claim success", narration_text: "Your coding agent says it's done. It often isn't." },
  { on_screen_text: "Write the failing check", narration_text: "Write the check first, then let the agent work." },
  { on_screen_text: "Make done provable", narration_text: "Next: add one failing check before your next agent task." },
];

test("the spec times each scene to its narration slot and ends on the ready skill", () => {
  const spec = motionSpec(artifact(), scenes, slots, { name: "write-the-check-first", tasks: 2 });
  assert.deepEqual(spec.scenes.map((s) => [s.code, s.d]), [["SAVED", 5.75], ["LESSON", 7.6], ["SKILL", 7]]);
  assert.equal(spec.scenes[0].sub, "Your coding agent says it's done.");
  assert.equal(spec.scenes[2].sub, "", "the skill card shows the skill, not an aside");
  assert.equal(spec.scenes[2].theme, "paper");
  assert.deepEqual(spec.skill, { name: "write-the-check-first", path: ".agents/skills/write-the-check-first/SKILL.md", tasks: "" });
  assert.deepEqual(spec.source, { kind: "youtube", platform: "YouTube", title: "Evals for coding agents", byline: "", tag: "YOUTUBE" });
});

test("without a ready skill the end card has no name, path or task count to show", () => {
  assert.equal(motionSpec(artifact(), scenes, slots, null).skill, null);
  assert.equal(motionSpec(artifact(), scenes, slots, { name: "x-y", tasks: 0 }).skill?.tasks, "");
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

test("the end card reads the skill's name from its SKILL.md and counts its tasks", async () => {
  assert.equal(skillNameOf('---\nname: write-the-check-first\ndescription: "x"\n---\n\nbody'), "write-the-check-first");
  assert.equal(skillNameOf("no frontmatter"), null);
  const store = new MemoryOutputStore(0), a = artifact();
  store.artifacts.push(a);
  assert.deepEqual(await store.skillCard(a), { status: "none", card: null });
  const c = (await store.claim("skill", a))!;
  assert.deepEqual(await store.skillCard(a), { status: "running", card: null });
  await store.finishSkill(c, { skill_markdown: "---\nname: write-the-check-first\n---\n", supporting_refs: [], action_items: [{ task: "t", applicability_evidence: [], prerequisites: [], steps: ["s"], source_refs: [], completion_check: "c" }] });
  assert.deepEqual(await store.skillCard(a), { status: "ready", card: { name: "write-the-check-first", tasks: 1 } });
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
    const v = await renderArtifact(a, { openaiKey: "o", geminiKey: "g", media, fetchImpl: outputsFetch(a).impl,
      skillCard: async () => ({ status: "ready", card: { name: "write-the-check-first", tasks: 1 } }) });
    assert.match(v.prompt_revision, /; visuals:motion-graphic-skill$/);
    assert.match(v.music_provenance ?? "", /Web Audio/);
    assert.deepEqual(keys, [`videos/${a.id}/1/short.mp4`, `captions/${a.id}/1/short.vtt`, `audio/${a.id}/1/narration.m4a`]);
    const p = await probe(join(out, `videos_${a.id}_1_short.mp4`));
    assert.deepEqual(p.video, { codec: "h264", width: 1080, height: 1920 });
    assert.equal(p.audio?.codec, "aac");
    assert.ok(Math.abs(p.duration - v.script.scenes.at(-1)!.end_seconds) < 0.5, "the film is as long as the narrated timeline");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("Chromium never sees the processor's keys", () => {
  const env = recordEnv({ PATH: "/usr/bin", HOME: "/home/node", CHROME: "/c", OPENAI_API_KEY: "sk-x", GEMINI_API_KEY: "g", DATABASE_URL: "postgres://u:p@h/db",
    R2_SECRET_ACCESS_KEY: "r", INGEST_TOKEN: "t", TWITTERAPI_IO_KEY: "k" });
  assert.deepEqual(env, { PATH: "/usr/bin", HOME: "/home/node", CHROME: "/c" });
});
