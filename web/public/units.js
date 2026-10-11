// The user's imported links and their real stages, kept up to date by polling on the home page.

import { api } from "./api.js";

const POLL_MS = 4000;

export const STAGE = {
  queued: "Queued",
  fetching: "Reading the source",
  digesting: "Picking out what's useful",
  rendering: "Rendering the short",
  ready: "Ready to watch",
  failed: "Couldn't read this link",
  render_failed: "Rendering failed",
  not_selected: "Nothing in it was worth a short",
};

export const PROCESSOR = {
  requested: "Processing started. Each link updates as it moves along.",
  not_needed: "You've imported these before, so you're seeing where they are.",
  not_configured: "Your links are saved. Processing isn't connected yet, so they're waiting in the queue.",
  unavailable: "Your links are saved, but processing didn't answer. They're waiting in the queue.",
};

const WATCH = /^https:\/\/(?:www\.youtube\.com\/watch\?v=[\w-]{11}|[a-z0-9-]+\.substack\.com\/p\/[\w-]+)$/;

export function renderUnits(list, units) {
  list.replaceChildren(
    ...units.map((u) => {
      const li = document.createElement("li");
      li.dataset.stage = u.stage;
      const name = document.createElement("a");
      if (WATCH.test(u.source_url)) name.href = u.source_url;
      name.target = "_blank";
      name.rel = "noopener noreferrer";
      name.textContent = u.title || u.source_url.replace(/^https:\/\/(?:www\.)?/, "");
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
 * Polls the user's imports and shorts every 4 s while something is moving,
 * and not at all once everything has settled.
 */
export function followImports({ onUnits, onItems, onError }) {
  let timer = null;
  async function refresh() {
    clearTimeout(timer);
    try {
      // Read the feed after progress so a final ready update cannot stop polling before its clip arrives.
      const { units } = await api("/api/imports");
      const { items } = await api("/api/feed?scope=mine");
      onUnits(units);
      onItems(items);
      const waiting = units.some((u) => !u.settled);
      const delay = waiting ? POLL_MS : null;
      if (delay) timer = setTimeout(refresh, document.hidden ? delay * 4 : delay);
    } catch (err) {
      onError?.(err);
      if (err.status !== 401) timer = setTimeout(refresh, POLL_MS * 3);
    }
  }
  refresh();
  return { refresh };
}
