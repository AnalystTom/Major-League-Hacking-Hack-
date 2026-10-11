// Onboarding: account -> project brief -> saved links -> processing. Each step saves to TigerData
// through the API, so leaving and coming back resumes at the first unfinished step.

import { api } from "./api.js";
import { followImports, PROCESSOR, renderUnits } from "./units.js";

const ORDER = ["account", "project", "sources", "processing"];
const root = document.querySelector("[data-onboard]");
const $ = (sel) => root.querySelector(sel);
let state = null;

function show(step) {
  $("[data-loading]").hidden = true;
  root.querySelectorAll("[data-step]").forEach((s) => (s.hidden = s.dataset.step !== step));
  const at = ORDER.indexOf(step);
  root.querySelectorAll("[data-step-dot]").forEach((d) => {
    const i = ORDER.indexOf(d.dataset.stepDot);
    d.dataset.state = i < at ? "done" : i === at ? "current" : "todo";
    if (i === at) d.setAttribute("aria-current", "step");
    else d.removeAttribute("aria-current");
  });
  history.replaceState(null, "", `#${step}`);
  const first = $(`[data-step="${step}"] input:not([type=hidden]):not(.visually-hidden), [data-step="${step}"] textarea`);
  first?.focus({ preventScroll: true });
  if (step === "processing") startFollowing();
}

function say(form, text, tone = "error") {
  const status = form.querySelector(".form-status");
  status.textContent = text;
  status.dataset.tone = tone;
}

/** Wires a form: disables its button while the request runs and shows the server's error in place. */
function onSubmit(name, handler) {
  const form = $(`[data-form="${name}"]`);
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    say(form, "", "pending");
    try {
      await handler(new FormData(form), form);
    } catch (err) {
      const detail = err.invalid?.map((i) => `${i.link}: ${i.error}`).join(" ");
      say(form, detail ? `${err.message} ${detail}` : err.message);
    } finally {
      button.disabled = false;
    }
  });
  return form;
}

function next(fromState) {
  state = fromState;
  if (state.step === "done") return location.assign("/app");
  show(state.step);
}

// ---------- 1. Account ----------

onSubmit("signup", async (data) => {
  next(await api("/api/auth/signup", {
    method: "POST",
    body: { name: data.get("name"), email: data.get("email"), password: data.get("password") },
  }));
});

onSubmit("login", async (data) => {
  next(await api("/api/auth/login", { method: "POST", body: { email: data.get("email"), password: data.get("password") } }));
});

$("[data-switch]").addEventListener("click", () => {
  const signup = $('[data-form="signup"]');
  const toLogin = !signup.hidden;
  signup.hidden = toLogin;
  $('[data-form="login"]').hidden = !toLogin;
  $("[data-account-title]").textContent = toLogin ? "Welcome back" : "Create your account";
  $("[data-switch-text]").textContent = toLogin ? "New to Resurface?" : "Already have an account?";
  $("[data-switch]").textContent = toLogin ? "Create an account" : "Sign in";
  $(`[data-form="${toLogin ? "login" : "signup"}"] input[type=email]`).focus();
});

// ---------- 2. Project ----------

const projectForm = onSubmit("project", async (data) => {
  const { project } = await api("/api/project", {
    method: "PUT",
    body: { name: data.get("name"), goal: data.get("goal"), tools: data.get("tools"), agents: data.getAll("agents") },
  });
  next({ ...state, project, step: state.imports > 0 ? "done" : "sources" });
});

$("[data-tool-suggest]").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const input = projectForm.elements.tools;
  const tools = input.value.split(",").map((t) => t.trim()).filter(Boolean);
  if (!tools.includes(b.textContent)) tools.push(b.textContent);
  input.value = tools.join(", ");
  b.setAttribute("aria-pressed", "true");
});

function fillProject(project) {
  if (!project) return;
  projectForm.elements.name.value = project.name ?? "";
  projectForm.elements.goal.value = project.goal ?? "";
  projectForm.elements.tools.value = project.tools.join(", ");
  projectForm.querySelectorAll('input[name="agents"]').forEach((c) => (c.checked = project.agents.includes(c.value)));
}

// ---------- 3. Sources ----------

onSubmit("sources", async (data, form) => {
  const links = String(data.get("links") || "").split(/\s+/).filter(Boolean);
  if (links.length === 0) throw new Error("Paste at least one YouTube link.");
  const body = await api("/api/imports", { method: "POST", body: { links, company: data.get("company") } });
  say(form, "", "ok");
  state = { ...state, imports: state.imports + body.units.length };
  $("[data-processing-note]").textContent = PROCESSOR[body.processor] ?? "";
  renderUnits($("[data-units]"), body.units);
  show("processing");
});

// ---------- 4. Processing ----------

let following = false;
function startFollowing() {
  if (following) return;
  following = true;
  followImports({
    onUnits: (units) => renderUnits($("[data-units]"), units),
    onItems: (items) => {
      if (items.length) $("[data-feed-hint]").textContent = `${items.length} ${items.length === 1 ? "short is" : "shorts are"} ready to watch.`;
    },
  });
}

// ---------- Resume ----------

(async () => {
  try {
    state = await api("/api/me");
  } catch (err) {
    if (err.status !== 401) $("[data-loading]").textContent = err.message;
    else show("account");
    return;
  }
  fillProject(state.project);
  // #project lets a signed-in user come back to edit their brief from the home page.
  const asked = location.hash.slice(1);
  if (asked === "project" || asked === "sources") return show(asked);
  if (state.step === "done") return location.assign("/app");
  show(state.step);
})();
