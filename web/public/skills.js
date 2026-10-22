// Each ready artifact's SKILL.md and the path where the chosen agent reads it. Every API string goes in through textContent.

import { AGENTS, agentOrDefault, skillAnchor, skillFile, skillSlug } from "./agents.js";
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
  running: "Writing the skill…",
  regenerating: "This skill is being regenerated.",
};

export function createSkills({ skillsList, picker, skillsStatus }) {
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
      const message = s.status === "regenerating" && s.error ? "Regeneration couldn't finish; the old skill is unavailable." : SKILL_STATE[s.status] ?? s.status;
      li.append(el("p", { class: "skill-state", text: s.status === "failed" ? failed.trim() : message }));
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

  function render() {
    skillsList.replaceChildren(...skills.map(skillCard));
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
      return { skills: ready.length };
    },
  };
}
