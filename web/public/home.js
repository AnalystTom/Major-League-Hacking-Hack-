// The signed-in home is the reel, full screen. Until the first short is ready, the reel's frame holds the
// paste box (new account) or what's happening to the links. Link stages otherwise live in the top-bar
// status popover, more videos come in through the Add videos sheet, and Skills and Tasks open in a sheet.

import { api } from "./api.js";
import { createReel } from "./reel.js";
import { createSkills } from "./skills.js";
import { FAILED_STAGES, followImports, PROCESSOR, renderUnits } from "./units.js";

const $ = (sel) => document.querySelector(sel);
const reel = createReel($("[data-reel]"));
const sheet = $("[data-add-sheet]");
const skillsSheet = $("[data-skills-sheet]");
const skills = createSkills({
  skillsList: $("[data-skills]"), tasksList: $("[data-tasks]"), picker: $("[data-agent]"),
  skillsStatus: $("[data-skills-status]"), tasksStatus: $("[data-tasks-status]"),
});
const form = $("[data-add-template]").content.firstElementChild.cloneNode(true);
let follower = null;


function placeForm(where) {
  const slot = $(where === "sheet" ? "[data-sheet-form-slot]" : "[data-first-form-slot]");
  if (form.parentElement !== slot) slot.append(form);
}

function summarize(units) {
  const making = units.filter((u) => !u.settled).length;
  const failed = units.filter((u) => FAILED_STAGES.has(u.stage)).length;
  const ready = units.filter((u) => u.stage === "ready").length;
  const parts = [];
  if (making) parts.push(`${making} making`);
  if (ready) parts.push(`${ready} ready`);
  if (failed) parts.push(`${failed} couldn't be made`);
  return parts.join(" · ");
}

function render(units, items) {
  reel.render(items);
  const hasShorts = reel.count > 0;

  const status = $("[data-status]");
  status.hidden = units.length === 0;
  status.dataset.busy = String(units.some((u) => !u.settled));
  $("[data-status-summary]").textContent = summarize(units);
  renderUnits($("[data-units]"), units);

  const first = $("[data-first]");
  first.hidden = hasShorts;
  $("[data-open-add]").hidden = !hasShorts && units.length === 0;
  if (hasShorts) {
    if (!sheet.open) placeForm("sheet");
    return;
  }

  const waiting = units.some((u) => !u.settled);
  const title = units.length === 0 ? "Paste your first videos" : waiting ? "Making your shorts" : "No shorts from these links yet";
  const lede = units.length === 0
    ? "Each YouTube video becomes a short, narrated clip of the part worth keeping."
    : waiting
      ? "Your first short starts playing here as soon as it's ready. You can leave; processing carries on."
      : "Each link below says what happened. Try other videos.";
  $("[data-first-title]").textContent = title;
  $("[data-first-lede]").textContent = lede;
  const list = $("[data-first-units]");
  list.hidden = units.length === 0;
  renderUnits(list, units);
  // While links are processing, more videos go through the sheet so the card stays about progress.
  if (!waiting && !sheet.open) placeForm("first");
  else if (waiting && form.parentElement === $("[data-first-form-slot]")) placeForm("sheet");
}

let units = [];
let items = [];

// Skills and tasks: counts on the top-bar buttons, the lists in the sheet.
function showSkills(list) {
  skills.update(list);
  const c = skills.counts;
  for (const [key, n] of Object.entries({ skills: c.skills, tasks: c.tasks })) {
    const b = $(`[data-count="${key}"]`);
    b.textContent = n ? String(n) : "";
    b.hidden = !n;
  }
  $('[data-open-skills="skills"]').hidden = list.length === 0;
  $('[data-open-skills="tasks"]').hidden = c.tasks === 0;
  $("[data-skills-empty]").hidden = list.length > 0;
  $("[data-tasks-empty]").hidden = c.tasks > 0;
  openPendingSkill();
}

function openSkills(target) {
  if (!skillsSheet.open) skillsSheet.showModal();
  // location.replace (not replaceState) so .skill:target applies, without adding a history entry.
  if (target?.startsWith("skill-")) location.replace(`#${target}`);
  const el = target && document.getElementById(target);
  (el ?? skillsSheet.querySelector(target === "tasks-title" ? "#tasks-title" : "#skills-title"))?.scrollIntoView({ block: "start" });
}

// A short's "View skill & tasks" link (#skill-<id>-<version>) opens the sheet at that card; the hash makes
// .skill:target highlight it. Coming back to /app with that hash does the same once the skills have loaded.
function openPendingSkill() {
  const id = location.hash.slice(1);
  if (id.startsWith("skill-") && document.getElementById(id) && !skillsSheet.open) openSkills(id);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#skill-"]');
  if (!a) return;
  e.preventDefault();
  openSkills(a.getAttribute("href").slice(1));
});
document.querySelectorAll("[data-open-skills]").forEach((b) =>
  b.addEventListener("click", () => openSkills(b.dataset.openSkills === "tasks" ? "tasks-title" : null)));
$("[data-close-skills]").addEventListener("click", () => skillsSheet.close());
skillsSheet.addEventListener("close", () => {
  if (location.hash.startsWith("#skill-")) history.replaceState(null, "", location.pathname);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = form.querySelector(".form-status");
  const button = form.querySelector("button");
  const links = String(new FormData(form).get("links") || "").split(/\s+/).filter(Boolean);
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
    form.reset();
    if (sheet.open) sheet.close();
    follower.refresh();
  } catch (err) {
    const detail = err.invalid?.map((i) => `${i.link}: ${i.error}`).join(" ");
    status.textContent = detail ? `${err.message} ${detail}` : err.message;
    status.dataset.tone = "error";
  } finally {
    button.disabled = false;
  }
});

$("[data-open-add]").addEventListener("click", () => {
  placeForm("sheet");
  sheet.showModal();
  form.querySelector("textarea").focus();
});
$("[data-close-add]").addEventListener("click", () => sheet.close());
sheet.addEventListener("close", () => render(units, items));

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

  // A new account sees the paste box straight away. Anyone with imports keeps the loading line until their
  // links and shorts arrive, so a slow or failed first load never looks like an empty account.
  let shown = false;
  const reveal = () => {
    if (shown) return;
    shown = true;
    $("[data-loading]").hidden = true;
    $("[data-home-body]").hidden = false;
  };
  if (me.imports === 0) {
    render([], []);
    reveal();
    form.querySelector("textarea").focus({ preventScroll: true });
  }
  // A failed check is shown wherever the user is looking: the loading line before the page appears, the reel's
  // frame for a new account (the status chip only exists once there are links), else the status list.
  let erroring = false;
  const showError = (err) => {
    const message = `${err.message} Retrying…`;
    erroring = true;
    if (!shown) $("[data-loading]").textContent = `Couldn't load your shorts. ${message}`;
    else if ($("[data-status]").hidden) Object.assign($("[data-first-note]"), { textContent: message }).dataset.tone = "error";
    else $("[data-run-note]").textContent = message;
  };
  const clearError = () => {
    if (!erroring) return;
    erroring = false;
    $("[data-first-note]").textContent = "";
    if ($("[data-run-note]").textContent.endsWith("Retrying…")) $("[data-run-note]").textContent = "";
  };
  follower = followImports({
    onUnits: (u) => { units = u; },
    onItems: (i) => { items = i; render(units, items); reveal(); clearError(); },
    onSkills: showSkills,
    onError: (err) => (err.status === 401 ? location.assign("/start") : showError(err)),
  });
})();
