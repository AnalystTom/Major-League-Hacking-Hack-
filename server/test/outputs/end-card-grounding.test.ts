// These two source/skill pairs were rejected in production for invented end-card paths.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillCardOf } from "../../src/outputs/store.js";
import { motionSpec, type SkillCard } from "../../src/outputs/render/motion-skill.js";
import { validateScript } from "../../src/outputs/render/script.js";
import { judgeShort } from "../../src/outputs/render/judge.js";
import { composeShort, probe } from "../../src/outputs/render/ffmpeg.js";
import { timeline } from "../../src/outputs/render/timeline.js";
import { toneWav } from "./helpers.js";
import type { ReadyArtifact } from "../../src/outputs/types.js";

const cases: { artifact: ReadyArtifact; skill: SkillCard }[] = JSON.parse(readFileSync(new URL("./fixtures/rejected-end-cards.json", import.meta.url), "utf8"));
const slots = timeline([0.8, 0.8, 0.8]);
const scriptFor = (a: ReadyArtifact) => validateScript({ scenes: slots.map((_, i) => ({
  narration_text: a.processed_text.split(/\s+/).slice(i * 15, (i + 1) * 15).join(" "),
  on_screen_text: a.name.split(/\s+/).slice(0, 5).join(" "), source_ids: a.source_ids,
})) }, a);

for (const { artifact, skill } of cases) {
  test(`previously rejected end card: ${skill.name}`, () => {
    const card = skillCardOf(`---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n`);
    assert.deepEqual(card, skill);
    const scenes = scriptFor(artifact);
    assert.ok(scenes.every(scene => scene.source_ids.length > 0));
    const spec = motionSpec(artifact, scenes, slots, card);
    assert.deepEqual(Object.keys(spec.skill!), ["name", "description"]);
    assert.equal(spec.skill!.name, skill.name);
    assert.ok(spec.skill!.description.length > 0 && spec.skill!.description.length <= 80);
    assert.ok(skill.description.startsWith(`${spec.skill!.description} `));
    assert.doesNotMatch(spec.skill!.description, /…/);
    assert.deepEqual(spec.scenes.map(scene => scene.d), [1.15, 1.15, 2.5]);
    assert.doesNotMatch(JSON.stringify(spec), /\.agents\/skills\/|SKILL\.md|SEND TO YOUR AGENT/);
    assert.throws(() => validateScript({ scenes: scenes.map((s, i) => ({ ...s, source_ids: i === scenes.length - 1 ? [] : s.source_ids })) }, artifact), /source_ids/);
  });
}

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();

test("the basic renderer pads closing audio to the extended scene end", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "resurface-closing-audio-"));
  try {
    const narration = [join(dir, "first.wav"), join(dir, "last.wav")];
    for (const file of narration) await writeFile(file, toneWav(0.8));
    const out = await composeShort({ dir, narration, onScreen: ["First scene", "Check first."], slots: timeline([0.8, 0.8]), category: null });
    assert.ok(Math.abs(out.duration - 3.65) < 0.05);
    assert.ok(Math.abs((await probe(out.narration)).duration - 3.65) < 0.05);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("both rejected cases supply skill evidence, narration samples and a late end-card sample", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "resurface-judge-evidence-")), mp4 = join(dir, "frames.mp4");
  try {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=1:d=7", "-vf", "drawbox=color=white:t=fill:enable=gte(t\\,4)", "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4]);
    for (const { artifact, skill } of cases) {
      const scenes = scriptFor(artifact).map((scene, i) => ({
        start_seconds: i, end_seconds: i === slots.length - 1 ? 6 : i + 1, narration_text: scene.narration_text,
        on_screen_text: scene.on_screen_text, visual_instruction: scene.visual_instruction, source_ids: scene.source_ids,
      }));
      let calls = 0;
      const fetchImpl: typeof fetch = async (_url, init) => {
        calls++;
        const request = JSON.parse(String(init?.body)), content = request.messages[1].content;
        const supplied = JSON.parse(content[0].text);
        assert.deepEqual(supplied.artifact, artifact);
        assert.deepEqual(supplied.scenes, scenes);
        assert.deepEqual(supplied.generated_skill, skill);
        const images = content.filter((c: { type: string }) => c.type === "image_url");
        assert.equal(images.length, scenes.length + 1);
        const pixel = (image: { image_url: { url: string } }) => execFileSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { input: Buffer.from(image.image_url.url.split(",")[1], "base64") });
        assert.ok(pixel(images[scenes.length - 1]).every(value => value < 15), "the narration sample precedes the delayed content");
        assert.ok(pixel(images.at(-1)).every(value => value > 240), "the additional sample includes the delayed content");
        return Response.json({ choices: [{ message: { content: JSON.stringify({ scores: { grounding: 4, clarity: 4, usefulness: 4, visuals: 4, subtitles: 4 }, reasons: [] }) } }] });
      };
      assert.ok((await judgeShort(artifact, scenes, mp4, dir, { apiKey: "test", fetchImpl }, skill)).passed);
      assert.equal(calls, 1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
