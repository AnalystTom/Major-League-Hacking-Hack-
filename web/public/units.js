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
  ready: "Ready to watch",
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

const OPENABLE = /^https:\/\/(?:www\.youtube\.com\/watch\?v=[\w-]{11}|x\.com\/i\/status\/\d{1,19})$/;

export function renderUnits(list, units) {
  list.replaceChildren(
    ...units.map((u) => {
      const li = document.createElement("li");
      li.dataset.stage = u.stage;
      const name = document.createElement("a");
      if (OPENABLE.test(u.source_url)) name.href = u.source_url;
      name.target = "_blank";
      name.rel = "noopener noreferrer";
      name.textContent = u.title || u.source_url.replace(/^https:\/\/www\./, "");
      const stage = document.createElement("span");
      stage.className = "unit-stage";
      stage.textContent = STAGE[u.stage] ?? u.stage;
      li.append(name, stage);
      if (u.error || FAILED_STAGES.has(u.stage)) {
        const why = document.createElement("p");
        why.className = "unit-error";
        why.textContent = u.error || "Reason unknown.";
        li.append(why);
      }
      return li;
    })
  );
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
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    clearTimeout(timer);
    try {
      // Read the feed after progress so a final ready update cannot stop polling before its clip arrives.
      const { units } = await api("/api/imports");
      const { items } = await api("/api/feed?scope=mine");
      // Skills are read separately: if /api/skills fails, links and shorts still update, the last skills stay, and
      // the next check retries them.
      let skills = [];
      let skillsError = null;
      if (onSkills) {
        try {
          ({ skills } = await api("/api/skills"));
        } catch (err) {
          if (err.status === 401) throw err;
          skillsError = err;
        }
      }
      const skillsFailed = skillsError !== null;
      onUnits(units);
      onItems(items);
      if (onSkills && !skillsFailed) onSkills(skills);
      // Reported after the shorts, so a page that clears its error note on fresh shorts still shows this one.
      if (skillsFailed) onError?.(skillsError);
      const waiting = units.some((u) => !u.settled) || skills.some(skillWriting) || skillsFailed;
      const skillDue = onSkills && items.some((i) => !i.skill) && skillChecks < SKILL_WAIT_CHECKS;
      if (waiting) skillChecks = 0;
      else if (skillDue) skillChecks++;
      const delay = waiting ? POLL_MS : skillDue ? SKILL_WAIT_MS : null;
      if (delay) timer = setTimeout(refresh, document.hidden ? delay * 4 : delay);
    } catch (err) {
      onError?.(err);
      if (err.status !== 401) timer = setTimeout(refresh, POLL_MS * 3);
    } finally {
      refreshing = false;
    }
  }
  refresh();
  return { refresh };
}
