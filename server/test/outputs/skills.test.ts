import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateSkill, slugify, validateSkill } from "../../src/outputs/skills.js";
import { artifact, outputsFetch, skillReply } from "./helpers.js";

test("a skill becomes a SKILL.md with frontmatter and the artifact's real sources", async () => {
  const a = artifact();
  const { impl, calls } = outputsFetch(a);
  const s = await generateSkill(a, { apiKey: "k", fetchImpl: impl });
  assert.equal(calls.skill, 1);
  assert.match(s.skill_markdown, /^---\nname: verify-before-done\ndescription: "Make the agent prove a change with a failing check first\."\n---\n/);
  assert.match(s.skill_markdown, /## Sources\n\n- \[Evals for coding agents\]\(https:\/\/www\.youtube\.com\/watch\?v=VQy50fuxI34\)/);
  assert.equal(s.action_items.length, 1);
  assert.equal(s.action_items[0].completion_check, "The new test fails before the change and passes after it.");
  assert.deepEqual(s.supporting_refs, a.sources);
});

test("a task citing a source outside the artifact fails instead of being kept", () => {
  const a = artifact();
  const raw = skillReply(a);
  raw.action_items[0].source_refs = [randomUUID()];
  assert.throws(() => validateSkill(raw, a), /isn't a source of this artifact/);
});

test("more than three tasks, or a task without a completion check, is rejected", () => {
  const a = artifact();
  const item = skillReply(a).action_items[0];
  assert.throws(() => validateSkill(skillReply(a, { action_items: [item, item, item, item] }), a));
  assert.throws(() => validateSkill(skillReply(a, { action_items: [{ ...item, completion_check: "" }] }), a));
  assert.equal(validateSkill(skillReply(a, { action_items: [] }), a).action_items.length, 0);
});

test("skill names are normalised to kebab-case", () => {
  assert.equal(slugify("Verify Before Done!"), "verify-before-done");
  assert.equal(slugify("  --Ünïcode__name-- "), "unicode-name");
  assert.equal(slugify("x".repeat(80)).length, 64);
});

test("an OpenAI error surfaces with its status", async () => {
  const a = artifact();
  const { impl } = outputsFetch(a, { openaiStatus: 429 });
  await assert.rejects(generateSkill(a, { apiKey: "k", fetchImpl: impl }), /OpenAI HTTP 429/);
});
