// "Send to your agent": the user picks ready skills, the processor merges them (often from several videos) into one
// prompt that installs the skills, reviews the user's recent work, and says where each lesson applies. Copying or
// downloading is an export; nothing here claims the agent received or finished anything.

import { api } from "./api.js";
import { AGENTS, agentOrDefault } from "./agents.js";
import { el } from "./dom.js";
import { copyText, download } from "./skills.js";

const POLL_MS = 3000;
const FILE = "resurface-handoff.md";
/** The processor keys prompts by its own agent ids. */
const PROMPT_KEY = { "claude-code": "claude", codex: "codex", cursor: "cursor", hermes: "hermes" };
/** How to start the agent with the downloaded prompt, from a terminal in the repository. */
const RUN = {
  "claude-code": `claude "$(cat ${FILE})"`,
  codex: `codex "$(cat ${FILE})"`,
};
const STATE = {
  pending: "Queued. Merging your skills into one prompt…",
  running: "Merging your skills into one prompt: grouping lessons, ordering the tasks…",
};

export function createHandoff(root, picker) {
  const $ = (sel) => root.querySelector(sel);
  const list = $("[data-handoff-skills]");
  const status = $("[data-handoff-status]");
  const result = $("[data-handoff-result]");
  const write = $("[data-handoff-write]");
  let skills = [];
  let picked = null; // Set of skill ids; null until the first list arrives (then everything ready is picked)
  let brief = null;
  let timer = null;
  let loadedLatest = false;

  const agent = () => agentOrDefault(picker.value);
  const mode = () => root.querySelector("input[name='handoff-mode']:checked")?.value ?? "review";
  const promptText = () => brief?.prompts?.[PROMPT_KEY[agent()]]?.[mode()] ?? null;
  const ready = () => skills.filter((s) => s.status === "ready");
  const sameSelection = () => brief && brief.skill_ids.length === picked.size && brief.skill_ids.every((id) => picked.has(id));

  function say(text, tone) {
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  }

  function renderPicks() {
    list.replaceChildren(...ready().map((s) => {
      const box = el("input", { type: "checkbox", value: s.id, onchange: (e) => {
        if (e.currentTarget.checked) picked.add(s.id);
        else picked.delete(s.id);
        renderResult();
      } });
      box.checked = picked.has(s.id);
      const videos = s.videos.map((v) => v.title).filter(Boolean);
      return el("li", {}, el("label", { class: "handoff-skill" }, box,
        el("span", {}, el("b", { text: s.name ?? s.artifact.name }),
          el("small", { text: [videos.length ? `From ${videos.join(" + ")}` : null, `${s.action_items.length} task${s.action_items.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ") }))));
    }));
  }

  function renderResult() {
    const name = AGENTS[agent()].name;
    // A failed or stuck brief for the same picks can be asked for again; a ready or moving one can't.
    const retry = brief && (brief.status === "failed" || brief.stuck);
    write.textContent = sameSelection() && retry ? "Try again"
      : sameSelection() ? (brief.status === "ready" ? `Prompt written for ${picked.size} skill${picked.size === 1 ? "" : "s"}` : "Writing the prompt…")
      : `Write the prompt for ${name}`;
    write.disabled = picked.size === 0 || (sameSelection() && !retry);
    if (!brief || brief.status !== "ready") {
      result.hidden = true;
      if (brief?.status === "failed") say(`Couldn't write the prompt. ${brief.error || "Reason unknown."} Try again.`, "error");
      else if (brief?.stuck) say(brief.note ?? "This is taking much longer than it should; processing may have stopped. Try again.", "error");
      else if (brief) say(STATE[brief.status] ?? brief.status);
      return;
    }
    const stale = !sameSelection();
    say(stale ? "You changed the skills since this prompt was written. Write it again to include them." : "", stale ? "error" : null);
    const text = promptText();
    $("[data-handoff-title]").textContent = brief.title;
    $("[data-handoff-summary]").textContent = brief.summary;
    $("[data-handoff-themes]").replaceChildren(...brief.themes.map((t) => el("li", { text: `${t.name} (${t.skills.length} skill${t.skills.length === 1 ? "" : "s"})` })));
    $("[data-handoff-tensions]").hidden = brief.tensions.length === 0;
    $("[data-handoff-tensions] p").textContent = `The sources disagree on: ${brief.tensions.join("; ")}. The prompt asks your agent to decide from your code.`;
    $("[data-handoff-actions]").replaceChildren(...brief.actions.map((a) => el("li", { text: a.title })));
    $("[data-handoff-agent]").textContent = name;
    $("[data-handoff-copy]").textContent = `Copy for ${name}`;
    const run = RUN[agent()];
    $("[data-handoff-run]").replaceChildren(...(run
      ? [el("span", { text: `Paste it into ${name} in your repository, or download it and run this there:` }), el("code", { text: run })]
      : [el("span", { text: `Paste it into ${name}'s agent chat with your repository open.` })]));
    $("[data-handoff-prompt]").textContent = text ?? "";
    result.hidden = false;
  }

  async function follow(id) {
    clearTimeout(timer);
    try {
      const { brief: latest } = await api(`/api/handoffs/${id}`);
      // A newer request may have replaced this brief while the poll was in flight; its answer no longer applies.
      if (brief?.id !== id) return;
      brief = latest;
      renderResult();
      if (brief.status === "pending" || brief.status === "running") timer = setTimeout(() => follow(id), POLL_MS);
    } catch (err) {
      if (brief?.id !== id) return;
      say(`${err.message} Retrying…`, "error");
      timer = setTimeout(() => follow(id), POLL_MS * 3);
    }
  }

  write.addEventListener("click", async () => {
    clearTimeout(timer);
    write.disabled = true;
    say("Sending your picks…");
    try {
      const body = await api("/api/handoffs", { method: "POST", body: { skill_ids: [...picked] } });
      brief = body.brief;
      if (body.processor === "not_configured" || body.processor === "unavailable") {
        // Nothing is writing it, so keep "Try again" through every re-render rather than polling a brief that won't move.
        brief = { ...brief, stuck: true, note: body.processor === "not_configured"
          ? "Saved, but processing isn't connected, so nothing can write the prompt yet."
          : "Saved, but processing didn't answer. Try again in a minute." };
        renderResult();
        return;
      }
      renderResult();
      if (brief.status !== "ready" && brief.status !== "failed") follow(brief.id);
    } catch (err) {
      say(err.message, "error");
      write.disabled = false;
    }
  });

  $("[data-handoff-copy]").addEventListener("click", async () => {
    const ok = await copyText(promptText() ?? "");
    say(ok ? `Copied. Paste it into ${AGENTS[agent()].name} with your repository open.` : "Your browser blocked copying. Use Download instead.", ok ? "ok" : "error");
  });
  $("[data-handoff-download]").addEventListener("click", () => download(FILE, promptText() ?? ""));
  picker.addEventListener("change", renderResult);
  root.querySelectorAll("input[name='handoff-mode']").forEach((r) => r.addEventListener("change", renderResult));

  return {
    /** Called with every /api/skills poll; keeps the user's picks and shows their newest prompt once. */
    async update(next) {
      const before = new Set(ready().map((s) => s.id));
      const shown = JSON.stringify(ready().map((s) => [s.id, s.name, s.action_items.length]));
      skills = next;
      if (picked === null) picked = new Set(ready().map((s) => s.id));
      else for (const s of ready()) if (!before.has(s.id)) picked.add(s.id); // newly ready skills start picked
      for (const id of [...picked]) if (!ready().some((s) => s.id === id)) picked.delete(id);
      // Polling re-sends the same list; rebuilding the checkboxes then would drop focus.
      if (JSON.stringify(ready().map((s) => [s.id, s.name, s.action_items.length])) !== shown) renderPicks();
      root.hidden = ready().length === 0;
      if (!loadedLatest && ready().length) {
        loadedLatest = true;
        try {
          const latest = (await api("/api/handoffs/latest")).brief;
          if (latest && latest.skill_ids.every((id) => ready().some((s) => s.id === id))) {
            brief = latest;
            picked = new Set(latest.skill_ids);
            renderPicks();
            if (latest.status === "pending" || latest.status === "running") follow(latest.id);
          }
        } catch {}
      }
      renderResult();
    },
  };
}
