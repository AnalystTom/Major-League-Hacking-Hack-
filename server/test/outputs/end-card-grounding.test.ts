// These two source/skill pairs were rejected in production for invented end-card paths.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillCardOf } from "../../src/outputs/store.js";
import { motionSpec, type SkillCard } from "../../src/outputs/render/motion-skill.js";
import { validateScript } from "../../src/outputs/render/script.js";
import { judgeShort } from "../../src/outputs/render/judge.js";
import type { ReadyArtifact } from "../../src/outputs/types.js";

const cases: { artifact: ReadyArtifact; skill: SkillCard }[] = JSON.parse(readFileSync(new URL("./fixtures/rejected-end-cards.json", import.meta.url), "utf8"));
const slots = [0, 1, 2].map(start => ({ start, speechEnd: start + 0.8, end: start + 1 }));
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
    assert.ok(skill.description.startsWith(spec.skill!.description.replace(/…$/, "")));
    assert.doesNotMatch(JSON.stringify(spec), /\.agents\/skills\/|SKILL\.md|SEND TO YOUR AGENT/);
    assert.throws(() => validateScript({ scenes: scenes.map((s, i) => ({ ...s, source_ids: i === scenes.length - 1 ? [] : s.source_ids })) }, artifact), /source_ids/);
  });
}

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();

test("both rejected cases supply their generated skill and scene citations as judge evidence", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "resurface-judge-evidence-")), mp4 = join(dir, "frames.mp4");
  try {
    // Include a trailing frame for seeks between the final scene’s 1 fps frames.
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=1:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4]);
    for (const { artifact, skill } of cases) {
      const scenes = scriptFor(artifact).map((scene, i) => ({
        start_seconds: i, end_seconds: i + 1, narration_text: scene.narration_text,
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
        assert.equal(content.filter((c: { type: string }) => c.type === "image_url").length, scenes.length);
        return Response.json({ choices: [{ message: { content: JSON.stringify({ scores: { grounding: 4, clarity: 4, usefulness: 4, visuals: 4, subtitles: 4 }, reasons: [] }) } }] });
      };
      assert.ok((await judgeShort(artifact, scenes, mp4, dir, { apiKey: "test", fetchImpl }, skill)).passed);
      assert.equal(calls, 1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
