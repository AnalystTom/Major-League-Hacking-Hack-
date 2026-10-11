// The user's imported links and their real stages, kept up to date by polling. Used by the last
// onboarding step and by the home page.

import { api } from "./api.js";

const POLL_MS = 4000;
const REVIEW_POLL_MS = 15000;

export const STAGE = {
  queued: "Queued",
  fetching: "Reading the video",
  digesting: "Picking out what's useful",
  rendering: "Rendering the short",
  in_review: "Rendered, waiting for a teammate to approve it",
  ready: "Ready to watch",
  failed: "Couldn't read this video",
  render_failed: "Rendering failed",
  rejected: "Rejected in review",
  not_selected: "Nothing in it fit your project",
};

export const PROCESSOR = {
  requested: "Processing started. Each link updates as it moves along.",
  not_needed: "You've imported these before, so you're seeing where they are.",
  not_configured: "Your links are saved. Processing isn't connected yet, so they're waiting in the queue.",
  unavailable: "Your links are saved, but processing didn't answer. They're waiting in the queue.",
};

const WATCH = /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/;

export function renderUnits(list, units) {
  list.replaceChildren(
    ...units.map((u) => {
      const li = document.createElement("li");
      li.dataset.stage = u.stage;
      const name = document.createElement("a");
      if (WATCH.test(u.source_url)) name.href = u.source_url;
      name.target = "_blank";
      name.rel = "noopener noreferrer";
      name.textContent = u.title || u.source_url.replace(/^https:\/\/www\./, "");
      const stage = document.createElement("span");
      stage.className = "unit-stage";
      stage.textContent = STAGE[u.stage] ?? u.stage;
      li.append(name, stage);
      if (u.error || ["failed", "render_failed", "not_selected"].includes(u.stage)) {
        const why = document.createElement("p");
        why.className = "unit-error";
        why.textContent = u.error || "Reason unknown.";
        li.append(why);
      }
      return li;
    })
  );
}

/**
 * Polls the user's imports and shorts: every 4 s while something is moving, every 15 s while a clip
 * awaits review (approval can land any time), and not at all once everything has settled.
 */
export function followImports({ onUnits, onItems, onError }) {
  let timer = null;
  async function refresh() {
    clearTimeout(timer);
    try {
      const [{ units }, { items }] = await Promise.all([api("/api/imports"), api("/api/feed?scope=mine")]);
      onUnits(units);
      onItems(items);
      const waiting = units.some((u) => !u.settled);
      const inReview = units.some((u) => u.stage === "in_review");
      const delay = waiting ? POLL_MS : inReview ? REVIEW_POLL_MS : null;
      if (delay) timer = setTimeout(refresh, document.hidden ? delay * 4 : delay);
    } catch (err) {
      onError?.(err);
      if (err.status !== 401) timer = setTimeout(refresh, POLL_MS * 3);
    }
  }
  refresh();
  return { refresh };
}
