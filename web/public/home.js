// The signed-in home and the whole workflow: paste links, watch each one's stage, play the shorts.
// A new account lands here straight from sign-up, with the paste box first.

import { api } from "./api.js";
import { createReel } from "./reel.js";
import { createSkills } from "./skills.js";
import { followImports, PROCESSOR, renderUnits } from "./units.js";

const $ = (sel) => document.querySelector(sel);
const reel = createReel($("[data-reel]"));
const skills = createSkills({
  skillsList: $("[data-skills]"), tasksList: $("[data-tasks]"), picker: $("[data-agent]"),
  skillsStatus: $("[data-skills-status]"), tasksStatus: $("[data-tasks-status]"),
});
const counts = { saved: 0, reel: 0, skills: 0, tasks: 0 };

// The four steps from the landing film, with what's actually there at each.
function showCounts(next) {
  Object.assign(counts, next);
  for (const [step, n] of Object.entries(counts)) {
    const b = document.querySelector(`[data-step="${step}"] [data-count]`);
    b.textContent = n ? String(n) : "";
    b.hidden = !n;
  }
}
let follower = null;

// First run (no links yet) leads with the paste box; afterwards it's "add more" above the list.
function setFirstRun(first) {
  $("[data-links]").hidden = first;
  $("[data-home-title]").textContent = first ? "Paste your first videos" : "Your shorts";
  $("[data-add-label]").textContent = first ? "Paste YouTube links, one per line (up to 10)" : "Add more YouTube links";
}

function showLinks(units) {
  renderUnits($("[data-units]"), units);
  setFirstRun(units.length === 0);
  showCounts({ saved: units.length });
}

function showSkills(list) {
  skills.update(list);
  const c = skills.counts;
  const any = list.length > 0 || counts.saved > 0;
  $("[data-skills-section]").hidden = !any;
  $("[data-tasks-section]").hidden = !any;
  $("[data-skills-empty]").hidden = list.length > 0;
  $("[data-tasks-empty]").hidden = c.tasks > 0;
  showCounts({ skills: c.skills, tasks: c.tasks });
}

const addForm = $("[data-add]");
addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = addForm.querySelector(".form-status");
  const button = addForm.querySelector("button");
  const links = String(new FormData(addForm).get("links") || "").split(/\s+/).filter(Boolean);
  if (!links.length) {
    status.textContent = "Paste at least one YouTube link.";
    status.dataset.tone = "error";
    return;
  }
  button.disabled = true;
  try {
    const body = await api("/api/imports", { method: "POST", body: { links } });
    $("[data-run-note]").textContent = PROCESSOR[body.processor] ?? "";
    status.textContent = "";
    addForm.reset();
    follower.refresh();
  } catch (err) {
    const detail = err.invalid?.map((i) => `${i.link}: ${i.error}`).join(" ");
    status.textContent = detail ? `${err.message} ${detail}` : err.message;
    status.dataset.tone = "error";
  } finally {
    button.disabled = false;
  }
});

$("[data-signout]").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
  location.assign("/");
});

(async () => {
  let me;
  try {
    me = await api("/api/me");
  } catch (err) {
    $("[data-loading]").textContent = err.message;
    return;
  }
  if (!me.user) return location.assign("/start");

  $("[data-who]").textContent = me.user.name || me.user.email;
  setFirstRun(me.imports === 0);
  $("[data-loading]").hidden = true;
  $("[data-home-body]").hidden = false;
  if (me.imports === 0) $("#add-links").focus({ preventScroll: true });
  follower = followImports({
    onUnits: showLinks,
    onItems: (items) => {
      reel.render(items);
      $("[data-reel-empty]").hidden = reel.count > 0;
      showCounts({ reel: reel.count });
    },
    onSkills: showSkills,
    onError: (err) => {
      if (err.status === 401) location.assign("/start");
      else $("[data-run-note]").textContent = `${err.message} Retrying…`;
    },
  });
})();
