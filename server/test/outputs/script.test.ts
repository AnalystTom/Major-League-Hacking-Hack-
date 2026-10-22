import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCRIPT_SYSTEM_PROMPT, validateScript, writeScript, reviseScript } from "../../src/outputs/render/script.js";
import { cueCheck, groundsFor, motionSpec } from "../../src/outputs/render/motion-skill.js";
import { assertJudged, publicationJudgment } from "../../src/outputs/render/judge.js";
import { MemoryOutputStore } from "../../src/outputs/store.js";
import { artifact, approvedJudgment, reviewReply, scriptReply } from "./helpers.js";

const narration = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const reply = (a: ReturnType<typeof artifact>, scenes: Record<string, unknown>[]) => ({
  scenes: scenes.map((s) => ({ narration_text: narration(16), on_screen_text: "Failing check first", source_ids: a.source_ids, ...s })),
});

test("writeScript delivers its instructions and artifact evidence to the model", async () => {
  const a = artifact(), raw = reply(a, [{}, {}]);
  let calls = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "gpt-6.1-sol");
    assert.equal(request.reasoning_effort, "medium");
    for (const file of ["SKILL.md", "references/story.md", "references/styles.md", "references/scene-patterns.md"]) {
      const reference = readFileSync(new URL(`../../assets/motion-graphic-skill/${file}`, import.meta.url), "utf8");
      assert.ok(request.messages[0].content.includes(reference), `the model receives the actual vendored ${file}`);
    }
    assert.deepEqual(request.messages, [
      { role: "system", content: SCRIPT_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ artifact: {
        name: a.name, category: a.category, processed_text: a.processed_text,
        source_ids: a.source_ids, evidence: a.evidence,
      } }) },
    ]);
    return Response.json({ choices: [{ message: { content: JSON.stringify(raw) } }] });
  };
  const scenes = await writeScript(a, { apiKey: "test", fetchImpl });
  assert.equal(calls, 1);
  assert.deepEqual(scenes.map(s => [s.narration_text, s.source_ids]), raw.scenes.map(s => [s.narration_text, s.source_ids]));
});

test("script effort can be overridden without changing other OpenAI calls", async () => {
  const before = process.env.SCRIPT_REASONING_EFFORT;
  process.env.SCRIPT_REASONING_EFFORT = "low";
  try {
    const a = artifact();
    await writeScript(a, { apiKey: "test", fetchImpl: async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).reasoning_effort,"low");
      return Response.json({choices:[{message:{content:JSON.stringify(reply(a,[{},{}]))}}]});
    } });
  } finally {
    if (before === undefined) delete process.env.SCRIPT_REASONING_EFFORT;
    else process.env.SCRIPT_REASONING_EFFORT = before;
  }
});

test("each scene keeps its move only when the template can draw it honestly", () => {
  const a = artifact({ processed_text: "Teams that added 3 checks per task caught regressions sooner." });
  const scenes = validateScript(reply(a, [
    { move: "strike", swap: "proof." },
    { move: "strike", swap: "" },
    { move: "roll", on_screen_text: "Vibes", swap: "Evals" },
    { move: "roll", on_screen_text: "Agents claim success", swap: "Proof" },
    { move: "count", on_screen_text: "3 checks per task" },
    { move: "count", on_screen_text: "40% fewer bugs" },
    { move: "stamp", swap: "Required" },
    { move: "dissolve" },
  ]), a);
  assert.deepEqual(scenes.map((s) => [s.move, s.swap]), [
    ["strike", "proof."],
    ["slam", ""], // nothing to strike to
    ["roll", "Evals"],
    ["slam", ""], // too long to roll, and a strike would keep words the roll replaced
    ["count", ""],
    ["slam", ""], // 40 isn't in the source, so it isn't counted up as if it were
    ["stamp", "Required"],
    ["slam", ""], // not a move the reel has
  ]);
  assert.equal(scenes[0].visual_instruction, "strike → proof.");
});

test("a count needs the number itself in the source, not a longer one that contains it", () => {
  const a = artifact({ processed_text: "Runs took 30 minutes; 3.5x faster after caching; 1,165 saved items." });
  const move = (on_screen_text: string) => validateScript(reply(a, [{ move: "count", on_screen_text }, {}]), a)[0].move;
  assert.equal(move("3 checks"), "slam");
  assert.equal(move("30 minutes"), "count");
  assert.equal(move("1,165 saves"), "count");
  assert.equal(move("165 saves"), "slam");
  assert.equal(move("$30 minutes"), "count");
  for (const signed of ["-30 minutes", "-$ 30 minutes", "+$30 minutes", "$ 30 minutes"]) {
    assert.equal(move(signed), "slam", `${signed} doesn't count up from zero`);
  }
});

test("an aside longer than a glance is dropped, and grounds pass through", () => {
  const a = artifact();
  const [s] = validateScript(reply(a, [{ aside: narration(14), ground: "cobalt" }, {}]), a);
  assert.equal(s.aside, "");
  assert.equal(s.ground, "cobalt");
  assert.equal(s.visual_instruction, "slam on cobalt");
});

test("grounds open on night, end on paper and never repeat back to back", () => {
  const g = (grounds: (string | undefined)[]) => groundsFor(grounds.map((ground) => ({ on_screen_text: "x", narration_text: "x", ground })));
  assert.deepEqual(g(["signal", "signal", "signal", "paper"]), ["night", "signal", "cobalt", "paper"]);
  assert.deepEqual(g(["night", "signal", "night", "paper"]), ["night", "signal", "night", "paper"], "the script's own grounds stand");
  assert.deepEqual(g([undefined, undefined, undefined, undefined, undefined]), ["night", "signal", "cobalt", "night", "paper"]);
  assert.deepEqual(g(["night", "paper", "paper"]), ["night", "signal", "paper"]);
  assert.deepEqual(g(["night", "paper"]), ["night", "paper"]);
});

test("the template gets each scene's move, swap and own aside", () => {
  const slots = [0, 1, 2].map((i) => ({ start: i * 5, speechEnd: i * 5 + 4.6, end: i * 5 + 5 }));
  const spec = motionSpec(artifact(), [
    { on_screen_text: "Agents claim success", narration_text: "They often aren't done.", aside: "Done is a claim.", move: "strike", swap: "proof." },
    { on_screen_text: "Vibes", narration_text: "Measure it.", aside: "", move: "roll", swap: "Evals", ground: "cobalt" },
    { on_screen_text: "Check first", narration_text: "Next, write one check.", aside: "x", move: "stamp", swap: "Now" },
  ], slots, null);
  assert.deepEqual(spec.scenes.map((s) => [s.theme, s.move, s.swap, s.sub]), [
    ["night", "strike", "proof.", "Done is a claim."],
    ["cobalt", "roll", "Evals", ""], // an empty aside stays empty: no narration repeated on screen
    ["paper", "slam", "", ""], // the end card draws the skill, not a move
  ]);
});

test("opening and closing scenes require known source IDs", () => {
  const a = artifact();
  assert.deepEqual(validateScript(reply(a, [{}, {}]), a).map(s => s.source_ids), [a.source_ids, a.source_ids]);
  for (const index of [0, 1]) {
    const raw = reply(a, [{}, {}]);
    raw.scenes[index].source_ids = [];
    assert.throws(() => validateScript(raw, a), /source_ids/);
  }
  assert.throws(() => validateScript(reply(a, [{ source_ids: ["unknown-source"] }, {}]), a), /isn't a source/);
});

test("the builder's cue receipt checks every move against the actual template timing", async () => {
  const directions = ["slam", "strike", "roll", "stamp", "count", "slam"];
  const scenes = directions.map(move => ({ narration_text: "Write a failing check first.", on_screen_text: "3 checks", move, swap: "proof" }));
  const slots = directions.map((_, i) => ({ start: i * 4, speechEnd: i * 4 + 3.65, end: i * 4 + 4 }));
  const receipt = await cueCheck(motionSpec(artifact(), scenes, slots, null), 2);
  assert.ok(receipt.startsWith("Round 2\n"));
  assert.doesNotMatch(receipt, /FAIL/);
  assert.match(receipt, /Scene 5: slam/);
  assert.match(receipt, /impact cues: 0 PASS/);
});

test("a revision cannot log fixes for unchanged scenes", async () => {
  const a = artifact(), raw = scriptReply(a), scenes = validateScript(raw, a);
  await assert.rejects(reviseScript(a, scenes, reviewReply(), { apiKey: "test", fetchImpl: async () =>
    Response.json({ choices: [{ message: { content: JSON.stringify({ ...raw, fixes: [{ axes: ["hook"], scenes: [0], description: "No actual change" }] }) } }] }) }), /unchanged scene/);
});

test("publication enforces both reviews, defect caps and logged score improvements", () => {
  const cues = approvedJudgment().cue_checks;
  const first = reviewReply(), second = reviewReply();
  first.axes.motion.score = 7;
  const unearned = publicationJudgment([first, second], [], cues);
  assert.equal(unearned.passed, false);
  assert.match(unearned.review_log, /Builder adjustment: motion 8 → 7/);
  assert.throws(() => assertJudged(unearned), /quality judge/);
  assert.throws(() => assertJudged(publicationJudgment([second], [], cues.slice(0, 1))), /quality judge/);
  const capped = reviewReply();
  capped.defects[0].result = "FAIL";
  const rejected = publicationJudgment([second, capped], [], cues);
  assert.equal(rejected.passed, false);
  assert.ok(rejected.reasons.some(reason => reason.includes("motion scored 6")));
  const missing = { ...approvedJudgment(), reviews: [reviewReply(), { ...reviewReply(), defects: [] }] };
  assert.throws(() => assertJudged(missing), /quality judge/);
});

test("a logged sound revision resolves an initial cue failure without erasing history", async () => {
  const a = artifact();
  const raw = reply(a, [{ on_screen_text: "Check before done", move: "strike", swap: "proof" }, {}]);
  const draft = validateScript(raw, a);
  const short = [{ start: 0, speechEnd: .75, end: 1.1 }, { start: 1.1, speechEnd: 3.25, end: 3.6 }];
  const longer = [{ start: 0, speechEnd: 1.65, end: 2 }, { start: 2, speechEnd: 4.15, end: 4.5 }];
  const firstCue = await cueCheck(motionSpec(a, draft, short, null), 1);
  assert.match(firstCue, /FAIL/);
  const first = reviewReply();
  first.sound_verified = false;
  first.axes.sound.score = 6;
  first.defects[10] = { id: "D11", result: "FAIL", evidence: firstCue };
  const revised = await reviseScript(a, draft, first, { apiKey: "test", fetchImpl: async () => Response.json({ choices: [{ message: { content: JSON.stringify({
    scenes: raw.scenes.map((scene, i) => i === 0 ? { ...scene, narration_text: `${scene.narration_text} Check before done.` } : scene),
    fixes: [{ axes: ["sound"], scenes: [0], description: "Lengthen the first scene so its strike cue lands before the cut" }],
  }) } }] }) });
  const finalCue = await cueCheck(motionSpec(a, revised.scenes, longer, null), 2);
  assert.doesNotMatch(finalCue, /FAIL/);
  const second = reviewReply();
  const judgment = publicationJudgment([first, second], revised.fixes, [firstCue, finalCue]);
  assert.equal(judgment.passed, true);
  assertJudged(judgment);
  assert.deepEqual(judgment.cue_checks, [firstCue, finalCue]);
  assert.equal(judgment.reviews[0].defects[10].result, "FAIL");
  assert.match(judgment.review_log, /D11 \| FAIL/);
  assert.equal(publicationJudgment([first, second], [], [firstCue, finalCue]).passed, false, "an unlogged score increase still cannot pass");
});

test("a final cue failure withholds publication even when the reviewer misses it", async () => {
  const a = artifact();
  const scenes = validateScript(reply(a, [{ on_screen_text: "Check before done", move: "strike", swap: "proof" }, {}]), a);
  const slots = [{ start: 0, speechEnd: .75, end: 1.1 }, { start: 1.1, speechEnd: 3.25, end: 3.6 }];
  const finalCue = await cueCheck(motionSpec(a, scenes, slots, null), 2);
  assert.match(finalCue, /FAIL/);
  const judgment = publicationJudgment([reviewReply(), reviewReply()], [], [approvedJudgment().cue_checks[0], finalCue]);
  assert.equal(judgment.passed, false);
  assert.ok(judgment.reasons.includes("Both rounds require cue-check receipts; the final round must pass."));
  const outputs = new MemoryOutputStore(0);
  const claim = (await outputs.claim("video", a))!;
  await assert.rejects(outputs.finishVideo(claim, { judgment, script: { scenes: [] }, prompt_revision: "test",
    media_ref: "r2:videos/new/short.mp4", caption_ref: "r2:captions/new/short.vtt", narration_ref: "r2:audio/new/narration.m4a", duration_seconds: 3.6 }), /quality judge/);
  const row = [...outputs.rows.video.values()][0];
  assert.equal(row.status, "running");
  assert.equal(row.value, undefined, "no unapproved media becomes published");
});
