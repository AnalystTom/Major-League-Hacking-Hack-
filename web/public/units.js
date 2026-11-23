import { api } from "./api.js";
import { skillWriting } from "./agents.js";

const POLL_MS = 4000;

export const FAILED_STAGES = new Set(["failed", "render_failed", "not_selected"]);

export const STAGE = {
  queued: "Queued",
  limited: "Limit reached",
  fetching: "Reading the source",
  digesting: "Picking out what's useful",
  writing_skill: "Writing your skill",
  rendering: "Rendering the short",
  reviewing: "Checking short quality",
  ready: "Ready to watch",
  skill_ready: "Skill ready",
  paused: "Video generation paused",
  video_requested: "Video requested",
  failed: "Couldn't read this source",
  render_failed: "Rendering failed",
  render_retrying: "Rendering failed, trying again",
  not_selected: "No skill came out of this",
};

export const PROCESSOR = {
  requested: "Processing started. Each link updates as it moves along.",
  not_needed: "You've imported these before, so you're seeing where they are.",
  not_configured: "Your links are saved. Processing isn't connected yet, so they're waiting in the queue.",
  unavailable: "Your links are saved, but processing didn't answer. They're waiting in the queue.",
};

export function settledNote(note, units) {
  return units.length && units.every((u) => u.settled)
    ? note.replace(PROCESSOR.requested, "").trim()
    : note;
}

export function firstScreenCopy(units) {
  if (units.length === 0) return {
    title: "Paste your first links",
    lede: "Each YouTube video or X post becomes a skill your coding agent can read, from the part worth keeping.",
  };
  if (units.some((u) => !u.settled)) return {
    title: "Reading your links",
    lede: "Your first skill shows up here as soon as it's ready. You can leave; processing carries on.",
  };
  if (units.some((u) => u.stage === "limited")) return {
    title: "Your links are in the queue",
    lede: "Resurface processes a limited number of links each day. These start on their own when there's room; you can leave.",
  };
  if (units.some((u) => u.skill_ready)) return {
    title: "Your skills are ready",
    lede: "Open Skills above to copy or download what you want to use.",
  };
  return { title: "Nothing from these links yet", lede: "Each link below says what happened. Try other links." };
}

const OPENABLE = /^https:\/\/(?:www\.youtube\.com\/watch\?v=[\w-]{11}|x\.com\/i\/status\/\d{1,19}|[a-z0-9-]+\.substack\.com\/p\/[\w-]+)$/;

const PHASE = {
  queued: 0, fetching: 0, digesting: 1, writing_skill: 1,
  rendering: 2, reviewing: 2, render_retrying: 2, video_requested: 2,
};
const MOVING = new Set(["fetching", "digesting", "writing_skill", "rendering", "reviewing", "render_retrying"]);

export function unitScanState(unit) {
  return {
    label: STAGE[unit.stage] ?? "Waiting for a status update",
    phase: PHASE[unit.stage] ?? null,
    moving: MOVING.has(unit.stage) && !unit.settled,
  };
}

export function renderUnits(list, units) {
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

export const SKILL_WAIT_MS = 20_000;
export const SKILL_WAIT_CHECKS = 15;

export function followImports({ onUnits, onItems, onSkills, onError }) {
  let timer = null;
  let skillChecks = 0;
  let run = new AbortController();
  const isCurrent = (token) => token === run;
  function schedule(token, delay) {
    clearTimeout(timer);
    timer = setTimeout(() => poll(token), delay);
  }
  async function poll(token) {
    clearTimeout(timer);
    const get = (path) => api(path, { signal: token.signal });
    try {
      const { units } = await get("/api/imports");
      const { items } = await get("/api/feed?scope=mine");
      let skills = [];
      let video = null;
      let skillsError = null;
      if (onSkills) {
        try {
          ({ skills, video = null } = await get("/api/skills"));
        } catch (err) {
          if (err.status === 401 || token.signal.aborted) throw err;
          skillsError = err;
        }
      }
      if (!isCurrent(token)) return;
      const skillsFailed = skillsError !== null;
      onUnits(units);
      onItems(items);
      if (onSkills && !skillsFailed) onSkills(skills, video);
      if (skillsFailed) onError?.(skillsError);
      const waiting = units.some((u) => !u.settled) || skills.some(skillWriting) || ["queued", "running", "retrying"].includes(video?.status) || skillsFailed;
      const skillDue = onSkills && items.some((i) => !i.skill) && skillChecks < SKILL_WAIT_CHECKS;
      if (waiting) skillChecks = 0;
      else if (skillDue) skillChecks++;
      const delay = waiting ? POLL_MS : skillDue ? SKILL_WAIT_MS : null;
      if (delay) schedule(token, document.hidden ? delay * 4 : delay);
    } catch (err) {
      if (!isCurrent(token)) return;
      onError?.(err);
      if (err.status !== 401) schedule(token, POLL_MS * 3);
    }
  }
  poll(run);
  return {
    refresh() {
      if (run) poll(run);
    },
    stop() {
      run?.abort();
      run = null;
      clearTimeout(timer);
    },
    resume() {
      run = new AbortController();
      return poll(run);
    },
  };
}
