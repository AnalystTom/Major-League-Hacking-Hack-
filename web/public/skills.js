// Skills and Tasks on the signed-in home: each ready artifact's SKILL.md, where the chosen agent reads it, and
// its tasks ready to paste into that agent. Every API string goes in through textContent.

import { AGENTS, agentOrDefault, evidenceLink, skillAnchor, skillFile, skillSlug, taskPrompt } from "./agents.js";
import { el } from "./dom.js";

const AGENT_KEY = "resurface-agent";

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = Object.assign(document.createElement("textarea"), { value: text });
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SKILL_STATE = {
  pending: "Queued to become a skill.",
  running: "Writing the skill and its tasks…",
};

export function createSkills({ skillsList, tasksList, picker, skillsStatus, tasksStatus }) {
  let skills = [];
  let agent = "claude-code";
  try { agent = agentOrDefault(localStorage.getItem(AGENT_KEY)); } catch {}

  picker.replaceChildren(...Object.entries(AGENTS).map(([id, a]) => el("option", { value: id, text: a.name })));
  picker.value = agent;
  picker.addEventListener("change", () => {
    agent = agentOrDefault(picker.value);
    try { localStorage.setItem(AGENT_KEY, agent); } catch {}
    render();
  });

  // Status messages go to the section's live region and clear after a moment.
  const timers = new Map();
  function say(region, ok, done, failed) {
    region.textContent = ok ? done : failed;
    region.dataset.tone = ok ? "ok" : "error";
    clearTimeout(timers.get(region));
    timers.set(region, setTimeout(() => (region.textContent = ""), 4000));
  }

  function skillCard(s) {
    const head = el("div", { class: "skill-head" },
      el("p", { class: "skill-from", text: [s.artifact.category, `from “${s.artifact.name}”`].filter(Boolean).join(" · ") }),
      el("h3", { text: s.name ?? s.artifact.name }),
      s.description ? el("p", { class: "skill-desc", text: s.description }) : null
    );
    const li = el("li", { class: "skill", id: skillAnchor(s.artifact.id, s.artifact.version), "data-status": s.status }, head);
    if (s.status !== "ready") {
      const failed = s.retrying ? `Couldn't write this skill yet; trying again in a few minutes. ${s.error || ""}` : `Couldn't write this skill. ${s.error || "Reason unknown."}`;
      li.append(el("p", { class: "skill-state", text: s.status === "failed" ? failed.trim() : SKILL_STATE[s.status] ?? s.status }));
      return li;
    }
    const file = skillFile(s, agent);
    const md = el("pre", { class: "skill-md", hidden: true }, el("code", { text: file.content }));
    const toggle = el("button", { type: "button", class: "btn-line", "aria-expanded": "false", text: "Show SKILL.md",
      onclick: (e) => {
        md.hidden = !md.hidden;
        e.currentTarget.setAttribute("aria-expanded", String(!md.hidden));
        e.currentTarget.textContent = md.hidden ? "Show SKILL.md" : "Hide SKILL.md";
      } });
    li.append(
      el("p", { class: "skill-path" }, el("span", { text: `${AGENTS[agent].name} reads it from` }), el("code", { text: file.path })),
      el("div", { class: "skill-actions" },
        el("button", { type: "button", class: "btn btn-small", text: "Copy SKILL.md",
          onclick: async () => say(skillsStatus, await copyText(file.content),
            `Copied. Save it as ${file.path} in your repo.`, "Your browser blocked copying. Use Download instead.") }),
        el("button", { type: "button", class: "btn-line", text: "Download",
          onclick: () => download(agent === "cursor" ? `${skillSlug(s)}.mdc` : "SKILL.md", file.content) }),
        toggle
      ),
      md
    );
    return li;
  }

  function taskCard(t, s) {
    const evidence = t.evidence.map((e) => {
      const link = evidenceLink(e, s.videos);
      return el("li", {}, el("p", { class: "task-passage", text: e.passage }),
        link ? el("a", { href: link.url, target: "_blank", rel: "noopener noreferrer", text: link.label }) : null);
    });
    return el("li", { class: "task" },
      el("p", { class: "skill-from", text: `From the ${s.name ?? s.artifact.name} skill` }),
      el("h3", { text: t.task }),
      t.prerequisites.length ? el("div", { class: "task-block" }, el("p", { class: "task-label", text: "Needs" }),
        el("ul", {}, ...t.prerequisites.map((p) => el("li", { text: p })))) : null,
      el("div", { class: "task-block" }, el("p", { class: "task-label", text: "Steps" }),
        el("ol", {}, ...t.steps.map((step) => el("li", { text: step })))),
      el("div", { class: "task-block task-check" }, el("p", { class: "task-label", text: "Done when" }), el("p", { text: t.completion_check })),
      evidence.length ? el("details", { class: "task-evidence" }, el("summary", { text: "Why it applies" }), el("ul", {}, ...evidence)) : null,
      el("div", { class: "skill-actions" },
        el("button", { type: "button", class: "btn btn-small", text: `Copy for ${AGENTS[agent].name}`,
          onclick: async () => say(tasksStatus, await copyText(taskPrompt(t, s, agent)),
            `Copied. Paste it into ${AGENTS[agent].name}; it's done when the check passes.`, "Your browser blocked copying.") }))
    );
  }

  function render() {
    skillsList.replaceChildren(...skills.map(skillCard));
    const tasks = skills.filter((s) => s.status === "ready").flatMap((s) => s.action_items.map((t) => taskCard(t, s)));
    tasksList.replaceChildren(...tasks);
  }

  return {
    /** Re-renders only when something changed, so polling doesn't close an open SKILL.md or move focus. */
    update(next) {
      const same = JSON.stringify(next) === JSON.stringify(skills);
      skills = next;
      if (!same) render();
    },
    get counts() {
      const ready = skills.filter((s) => s.status === "ready");
      return { skills: ready.length, tasks: ready.reduce((n, s) => n + s.action_items.length, 0) };
    },
  };
}
