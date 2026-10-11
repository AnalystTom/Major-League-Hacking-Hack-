// Sign up or sign in, then straight to /app, where the user pastes links and watches their reel.

import { api } from "./api.js";

const root = document.querySelector("[data-onboard]");
const $ = (sel) => root.querySelector(sel);

function show() {
  $("[data-loading]").hidden = true;
  $('[data-step="account"]').hidden = false;
  $('[data-form="signup"] input').focus({ preventScroll: true });
}

/** Wires a form: disables its button while the request runs and shows the server's error in place. */
function onSubmit(name, path, body) {
  const form = $(`[data-form="${name}"]`);
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector(".form-status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    status.textContent = "";
    try {
      await api(path, { method: "POST", body: body(new FormData(form)) });
      location.assign("/app");
    } catch (err) {
      status.textContent = err.message;
      status.dataset.tone = "error";
      button.disabled = false;
    }
  });
}

onSubmit("signup", "/api/auth/signup", (d) => ({ name: d.get("name"), email: d.get("email"), password: d.get("password") }));
onSubmit("login", "/api/auth/login", (d) => ({ email: d.get("email"), password: d.get("password") }));

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

// Already signed in: nothing to do here. #account (the landing page's Sign in link) opens the sign-in form.
(async () => {
  try {
    const me = await api("/api/me");
    if (me.user) return location.assign("/app");
  } catch (err) {
    $("[data-loading]").textContent = err.message;
    return;
  }
  show();
  if (location.hash === "#signin") $("[data-switch]").click();
})();
