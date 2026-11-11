// The user's imported links and their real stages, kept up to date by polling on the home page.

import { api } from "./api.js";
import { skillWriting } from "./agents.js";

const POLL_MS = 4000;

/** Stages where a link stopped without a short: each shows its reason. */
export const FAILED_STAGES = new Set(["failed", "render_failed", "not_selected"]);

export const STAGE = {
  queued: "Queued",
  limited: "Limit reached",
  fetching: "Reading the source",
  digesting: "Picking out what's useful",
  rendering: "Rendering the short",
  reviewing: "Checking short quality",
  ready: "Ready to watch",
  skill_ready: "Skill ready",
  paused: "Video generation paused",
  video_requested: "Video requested",
  failed: "Couldn't read this source",
  render_failed: "Rendering failed",
  render_retrying: "Rendering failed, trying again",
  not_selected: "Nothing in it was worth a short",
};

export const PROCESSOR = {
  requested: "Processing started. Each link updates as it moves along.",
  not_needed: "You've imported these before, so you're seeing where they are.",
  not_configured: "Your links are saved. Processing isn't connected yet, so they're waiting in the queue.",
  unavailable: "Your links are saved, but processing didn't answer. They're waiting in the queue.",
};

/** Drop the transient start message once the backend reports every imported link settled. */
export function settledNote(note, units) {
  return units.length && units.every((u) => u.settled)
    ? note.replace(PROCESSOR.requested, "").trim()
    : note;
}

const OPENABLE = /^https:\/\/(?:www\.youtube\.com\/watch\?v=[\w-]{11}|x\.com\/i\/status\/\d{1,19}|[a-z0-9-]+\.substack\.com\/p\/[\w-]+)$/;

// The scan marks the reported phase, never elapsed time or estimated completion.
const PHASE = {
  queued: 0, fetching: 0, digesting: 1,
  rendering: 2, reviewing: 2, render_retrying: 2, video_requested: 2,
};
const MOVING = new Set(["fetching", "digesting", "rendering", "reviewing", "render_retrying"]);

export function unitScanState(unit) {
  return {
    label: STAGE[unit.stage] ?? "Waiting for a status update",
    phase: PHASE[unit.stage] ?? null,
    moving: MOVING.has(unit.stage) && !unit.settled,
  };
}

export function renderUnits(list, units) {
  // Keep rows across polls so focus and the scan aren't restarted by an unchanged response.
  const existing = new Map(Array.from(list.children, (li) => [li.dataset.unit, li]));
  const rows = units.map((u) => {
    const state = unitScanState(u);
    const key = u.id || u.source_url;
    let li = existing.get(key);
    if (!li) {
      li = document.createElement("li");
      li.dataset.unit = key;
    }
    const changed = li.dataset.stage !== u.stage;
    li.dataset.stage = u.stage;
    li.dataset.moving = String(state.moving);
    const name = li.querySelector("a") || document.createElement("a");
    if (OPENABLE.test(u.source_url)) name.href = u.source_url;
    else name.removeAttribute("href");
    name.target = "_blank";
    name.rel = "noopener noreferrer";
    name.textContent = u.title || u.source_url.replace(/^https:\/\/(?:www\.)?/, "");
    const stage = li.querySelector(".unit-stage") || document.createElement("span");
    stage.className = "unit-stage";
    stage.setAttribute("role", "status");
    const label = state.label;
    if (stage.textContent !== label) stage.textContent = label;
    if (!name.parentElement) li.append(name, stage);
    if (changed) {
      li.querySelector(".unit-scan")?.remove();
      const scan = document.createElement("div");
      scan.className = "unit-scan";
      scan.setAttribute("aria-hidden", "true");
      for (const [index, label] of ["Source", "Digest", "Output"].entries()) {
        const step = document.createElement("span");
        step.textContent = label;
        step.dataset.current = String(state.phase === index);
        scan.append(step);
      }
      li.append(scan);
    }
    li.querySelector(".unit-error")?.remove();
    li.querySelector(".unit-note")?.remove();
    if (u.preview_only && u.stage !== "failed") {
      const note = document.createElement("p");
      note.className = "unit-note";
      note.textContent = "Only a preview of this X Article could be read, so what Resurface made from it is based on the preview.";
      li.append(note);
    }
    if (u.error || FAILED_STAGES.has(u.stage)) {
      const why = document.createElement("p");
      why.className = "unit-error";
      why.textContent = u.error || "Reason unknown.";
      li.append(why);
    }
    return li;
  });
  for (const li of existing.values()) if (!rows.includes(li)) li.remove();
  rows.forEach((li, index) => {
    if (list.children[index] !== li) list.insertBefore(li, list.children[index] || null);
  });
}


// A ready short whose skill hasn't been started yet (the processor's sweep picks it up) gets slower checks for
// a few minutes, so that skill still appears without polling forever for one that never comes.
export const SKILL_WAIT_MS = 20_000;
export const SKILL_WAIT_CHECKS = 15;

/**
 * Polls the user's imports and shorts (and skills, with onSkills) every 4 s while something is moving,
 * and not at all once everything has settled. A skill can still be writing after its short is ready.
 */
export function followImports({ onUnits, onItems, onSkills, onError }) {
  let timer = null;
  let skillChecks = 0;
  async function refresh() {
    clearTimeout(timer);
    try {
      // Read the feed after progress so a final ready update cannot stop polling before its clip arrives.
      const { units } = await api("/api/imports");
      const { items } = await api("/api/feed?scope=mine");
      // Skills are read separately: if /api/skills fails, links and shorts still update, the last skills stay, and
      // the next check retries them.
      let skills = [];
      let video = null;
      let skillsError = null;
      if (onSkills) {
        try {
          ({ skills, video = null } = await api("/api/skills"));
        } catch (err) {
          if (err.status === 401) throw err;
          skillsError = err;
        }
      }
      const skillsFailed = skillsError !== null;
      onUnits(units);
      onItems(items);
      if (onSkills && !skillsFailed) onSkills(skills, video);
      // Reported after the shorts, so a page that clears its error note on fresh shorts still shows this one.
      if (skillsFailed) onError?.(skillsError);
      const waiting = units.some((u) => !u.settled) || skills.some(skillWriting) || ["queued", "running", "retrying"].includes(video?.status) || skillsFailed;
      const skillDue = onSkills && items.some((i) => !i.skill) && skillChecks < SKILL_WAIT_CHECKS;
      if (waiting) skillChecks = 0;
      else if (skillDue) skillChecks++;
      const delay = waiting ? POLL_MS : skillDue ? SKILL_WAIT_MS : null;
      if (delay) timer = setTimeout(refresh, document.hidden ? delay * 4 : delay);
    } catch (err) {
      onError?.(err);
      if (err.status !== 401) timer = setTimeout(refresh, POLL_MS * 3);
    }
  }
  refresh();
  return { refresh };
}
