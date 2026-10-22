import test from "node:test";
import assert from "node:assert/strict";
import { SCRIPT_PROMPT_REVISION, SCRIPT_SYSTEM_PROMPT, validateScript } from "../../src/outputs/render/script.js";
import { groundsFor, motionSpec } from "../../src/outputs/render/motion-skill.js";
import { artifact } from "./helpers.js";

const narration = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const reply = (a: ReturnType<typeof artifact>, scenes: Record<string, unknown>[]) => ({
  scenes: scenes.map((s) => ({ narration_text: narration(16), on_screen_text: "Failing check first", source_ids: a.source_ids, ...s })),
});

test("script-v3 directs the picture in the reel's terms and keeps the source's own strength", () => {
  assert.equal(SCRIPT_PROMPT_REVISION, "script-v3-cited-scenes");
  for (const rule of ['"strike"', '"roll"', '"stamp"', '"count"', '"cobalt"', 'Don\'t open with "The problem is"', 'no "all", "always"', "Never pad"]) {
    assert.ok(SCRIPT_SYSTEM_PROMPT.includes(rule), `prompt says ${rule}`);
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
