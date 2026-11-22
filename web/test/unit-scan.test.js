import test from "node:test";
import assert from "node:assert/strict";
import { firstScreenCopy, PROCESSOR, settledNote, unitScanState } from "../public/units.js";

test("the scan follows backend stages without estimating completion", () => {
  assert.deepEqual(unitScanState({ stage: "queued", settled: false }), {
    label: "Queued", phase: 0, moving: false,
  });
  for (const [stage, phase] of [["fetching", 0], ["digesting", 1], ["writing_skill", 1], ["rendering", 2], ["reviewing", 2], ["render_retrying", 2]]) {
    const state = unitScanState({ stage, settled: false });
    assert.equal(state.phase, phase);
    assert.equal(state.moving, true);
    assert.doesNotMatch(state.label, /ready|complete|%/i);
    assert.equal(unitScanState({ stage, settled: true }).moving, false);
  }
  for (const stage of ["limited", "failed", "render_failed", "not_selected", "paused", "skill_ready", "ready"]) {
    assert.equal(unitScanState({ stage, settled: true }).moving, false);
    assert.equal(unitScanState({ stage, settled: true }).phase, null);
  }
  assert.deepEqual(unitScanState({ stage: "writing_skill", settled: false }), {
    label: "Writing your skill", phase: 1, moving: true,
  });
  assert.deepEqual(unitScanState({ stage: "unknown_provider_state", settled: false }), {
    label: "Waiting for a status update", phase: null, moving: false,
  });
});

test("completed imports clear only transient processing copy, including the X read summary", () => {
  const note = `Read 3 bookmarks. ${PROCESSOR.requested}`;
  assert.equal(settledNote(note, []), note);
  assert.equal(settledNote(note, [{ settled: true }, { settled: false }]), note);
  for (const stage of ["skill_ready", "ready", "failed", "limited"]) {
    const units = [{ stage, settled: true }];
    assert.equal(settledNote(note, units), "Read 3 bookmarks.");
    assert.equal(settledNote(PROCESSOR.requested, units), "");
    assert.equal(settledNote(PROCESSOR.unavailable, units), PROCESSOR.unavailable);
  }
});

test("the first screen counts a ready skill as a result even when its short failed", () => {
  const skillWithoutShort = { stage: "render_failed", settled: true, skill_ready: true };
  assert.equal(firstScreenCopy([skillWithoutShort]).title, "Your skills are ready");
  assert.equal(firstScreenCopy([{ stage: "skill_ready", settled: true, skill_ready: true }]).title, "Your skills are ready");
  assert.equal(firstScreenCopy([{ stage: "render_failed", settled: true, skill_ready: false }]).title, "Nothing from these links yet");
  assert.equal(firstScreenCopy([{ stage: "failed", settled: true, skill_ready: false }, skillWithoutShort]).title, "Your skills are ready");
  assert.equal(firstScreenCopy([skillWithoutShort, { stage: "digesting", settled: false, skill_ready: false }]).title, "Reading your links");
  assert.equal(firstScreenCopy([]).title, "Paste your first links");
});
