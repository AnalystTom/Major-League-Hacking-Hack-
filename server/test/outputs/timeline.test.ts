import test from "node:test";
import assert from "node:assert/strict";
import { captionCues, SCENE_GAP_SECONDS, timeline, toVtt, wrap } from "../../src/outputs/render/timeline.js";
import { validateScript } from "../../src/outputs/render/script.js";
import { headerText } from "../../src/outputs/render/ffmpeg.js";
import { randomUUID } from "node:crypto";
import { artifact, scriptReply } from "./helpers.js";

test("scene times follow the measured narration, ordered and without overlap", () => {
  const slots = timeline([2.5, 4, 3.25]);
  assert.deepEqual(slots[0], { start: 0, speechEnd: 2.5, end: 2.5 + SCENE_GAP_SECONDS });
  for (let i = 1; i < slots.length; i++) {
    assert.equal(slots[i].start, slots[i - 1].end);
    assert.ok(slots[i].end > slots[i].start);
  }
  assert.throws(() => timeline([2, 0]), /no measurable length/);
  assert.throws(() => timeline([NaN]), /no measurable length/);
});

test("captions split each scene's narration and stay inside its speech", () => {
  const narration = ["one two three four five six seven eight nine ten eleven twelve thirteen", "short"];
  const slots = timeline([4, 1]);
  const cues = captionCues(narration, slots, 20);
  assert.ok(cues.every((c) => c.text.length <= 20 && c.end > c.start));
  assert.equal(cues[0].start, 0);
  const last = cues.filter((c) => c.start < slots[0].end).at(-1)!;
  assert.ok(Math.abs(last.end - slots[0].speechEnd) < 0.01);
  assert.equal(cues.at(-1)!.text, "short");
});

test("a 1.15-second closing slot extends to 2.5 seconds without shifting speech or earlier scenes", () => {
  const slots = timeline([0.5, 0.8, 0.8]);
  assert.deepEqual(slots, [
    { start: 0, speechEnd: 0.5, end: 0.85 },
    { start: 0.85, speechEnd: 1.65, end: 2 },
    { start: 2, speechEnd: 2.8, end: 4.5 },
  ]);
  assert.deepEqual(captionCues(["Opening", "Lesson", "Check first."], slots), [
    { start: 0, end: 0.5, text: "Opening" },
    { start: 0.85, end: 1.65, text: "Lesson" },
    { start: 2, end: 2.8, text: "Check first." },
  ]);
  assert.deepEqual(timeline([0.8]), [{ start: 0, speechEnd: 0.8, end: 2.5 }]);
  assert.deepEqual(timeline([0.5, 0.8, 3]).at(-1), { start: 2, speechEnd: 5, end: 5.35 });
});

test("WebVTT output has a header and well-formed cue times", () => {
  const vtt = toVtt([{ start: 0, end: 1.5, text: "hello" }, { start: 61.25, end: 3725.001, text: "a --> b" }]);
  assert.match(vtt, /^WEBVTT\n\n1\n00:00:00\.000 --> 00:00:01\.500\nhello\n/);
  assert.match(vtt, /00:01:01\.250 --> 01:02:05\.001\na → b/);
});

test("on-screen text wraps on words", () => {
  assert.equal(wrap("Write the check before the agent says done", 16), "Write the check\nbefore the agent\nsays done");
});

test("a script citing an unknown source or far off length is rejected", () => {
  const a = artifact();
  assert.equal(validateScript(scriptReply(a), a).length, 4);
  const bad = scriptReply(a);
  bad.scenes[1].source_ids = [randomUUID()];
  assert.throws(() => validateScript(bad, a), /isn't a source/);
  assert.throws(() => validateScript({ scenes: [{ narration_text: "too short", on_screen_text: "x", source_ids: a.source_ids }, { narration_text: "yes", on_screen_text: "y", source_ids: a.source_ids }] }, a), /words/);
});

test("the frame header puts a long category on its own clipped line", () => {
  assert.equal(headerText(null), "RESURFACE");
  assert.equal(headerText("Agent evals"), "RESURFACE\nAGENT EVALS");
  const long = headerText("Post-training pipelines and evaluation environments");
  assert.equal(long, "RESURFACE\nPOST-TRAINING PIPELINES AND EVALU…");
  assert.equal(long.split("\n")[1].length, 34);
});
