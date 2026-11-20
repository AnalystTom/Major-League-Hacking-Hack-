import { api } from "./api.js";
import { showCatalogueLinks } from "./catalogue-links.js";
import { connectX } from "./x-connect.js";
import { createReel } from "./reel.js";
import { createSkills } from "./skills.js";
import { FAILED_STAGES, followImports, PROCESSOR, renderUnits, settledNote } from "./units.js";

const $ = (sel) => document.querySelector(sel);
const reel = createReel($("[data-reel]"));
const sheet = $("[data-add-sheet]");
const skillsSheet = $("[data-skills-sheet]");
const skills = createSkills({
  skillsList: $("[data-skills]"), picker: $("[data-agent]"),
  skillsStatus: $("[data-skills-status]"), review: true, onSaved: (list, video) => { showSkills(list, video); follower?.refresh(); },
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
  for (const note of document.querySelectorAll("[data-first-note], [data-run-note], [data-x-note]")) {
    note.textContent = settledNote(note.textContent, units);
  }
  const hasShorts = reel.count > 0;

  const status = $("[data-status]");
  status.hidden = units.length === 0 || !hasShorts;
  if (status.hidden) status.open = false;
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
  const limited = !waiting && units.some((u) => u.stage === "limited");
  const skillsReady = units.some(u => u.stage === "skill_ready");
  const title = units.length === 0 ? "Paste your first links" : waiting ? "Reading your links" : limited ? "Your links are in the queue" : skillsReady ? "Your skills are ready" : "Nothing from these links yet";
  const lede = units.length === 0
    ? "Each YouTube video, X post or Substack post becomes a skill your coding agent can read, from the part worth keeping."
    : waiting
      ? "Your first skill shows up here as soon as it's ready. You can leave; processing carries on."
      : limited
        ? "Resurface processes a limited number of links each day. These start on their own when there's room; you can leave."
        : skillsReady ? "Open Skills above to copy or download what you want to use." : "Each link below says what happened. Try other links.";
  $("[data-first-title]").textContent = title;
  $("[data-first-lede]").textContent = lede;
  const list = $("[data-first-units]");
  list.hidden = units.length === 0;
  renderUnits(list, units);
  if (!waiting && !sheet.open) placeForm("first");
  else if (waiting && form.parentElement === $("[data-first-form-slot]")) placeForm("sheet");
}

let units = [];
let items = [];

function showSkills(list, video) {
  skills.update(list, video);
  const c = skills.counts;
  for (const [key, n] of Object.entries({ skills: c.skills })) {
    const b = $(`[data-count="${key}"]`);
    b.textContent = n ? String(n) : "";
    b.hidden = !n;
  }
  $('[data-open-skills="skills"]').hidden = list.length === 0;
  $("[data-skills-empty]").hidden = list.length > 0;
  openPendingSkill();
}

function openSkills(target) {
  if (!skillsSheet.open) skillsSheet.showModal();
  if (target?.startsWith("skill-")) location.replace(`#${target}`);
  const el = target && document.getElementById(target);
  (el ?? skillsSheet.querySelector("#skills-title"))?.scrollIntoView({ block: "start" });
}

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
  b.addEventListener("click", () => openSkills(null)));
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
    status.textContent = "Paste at least one YouTube, X post or Substack link.";
    status.dataset.tone = "error";
    return;
  }
  button.disabled = true;
  try {
    const body = await api("/api/imports", { method: "POST", body: { links } });
    const skipped = body.invalid?.length
      ? `${body.invalid.length} link${body.invalid.length === 1 ? "" : "s"} couldn't be added: ${body.invalid.map((i) => `${i.link} (${i.error})`).join("; ")}`
      : "";
    $($("[data-status]").hidden ? "[data-first-note]" : "[data-run-note]").textContent = [PROCESSOR[body.processor], skipped].filter(Boolean).join(" ");
    status.textContent = "";
    form.reset();
    if (skipped) form.querySelector("textarea").value = body.invalid.map((i) => i.link).join("\n");
    else if (sheet.open) sheet.close();
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
  follower?.stop();
  await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
  location.assign("/");
});

const deleteSheet = $("[data-delete-sheet]");
$("[data-open-delete]").addEventListener("click", () => deleteSheet.showModal());
$("[data-close-delete]").addEventListener("click", () => deleteSheet.close());
$("[data-confirm-delete]").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const status = $("[data-delete-status]");
  button.disabled = true;
  status.textContent = "";
  follower?.stop();
  try {
    await api("/api/me", { method: "DELETE", body: {} });
    location.assign("/");
  } catch (err) {
    follower?.resume();
    status.textContent = err.message;
    status.dataset.tone = "error";
    button.disabled = false;
  }
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
  showCatalogueLinks(document);

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
    if (form.querySelector("[data-paste-fallback]").open) form.querySelector("textarea").focus({ preventScroll: true });
  }
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
  connectX(form.querySelector("[data-x-connect]"), {
    onImported: () => follower.refresh(),
    onError: err => { $("[data-first-note]").textContent = err.message; },
    onReady: state => { form.querySelector("[data-paste-fallback]").open = !state.available; },
  });
})();
