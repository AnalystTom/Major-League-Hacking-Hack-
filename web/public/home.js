// The signed-in home: the user's links with live stages, and their shorts.

import { api } from "./api.js";
import { createReel } from "./reel.js";
import { followImports, PROCESSOR, renderUnits } from "./units.js";

const $ = (sel) => document.querySelector(sel);
const reel = createReel($("[data-reel]"));
let follower = null;

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
  // Onboarding isn't finished: go back to the first open step.
  if (me.step !== "done") return location.assign(`/start#${me.step}`);

  $("[data-who]").textContent = me.user.name || me.user.email;
  $("[data-loading]").hidden = true;
  $("[data-home-body]").hidden = false;
  follower = followImports({
    onUnits: (units) => renderUnits($("[data-units]"), units),
    onItems: (items) => {
      reel.render(items);
      $("[data-reel-empty]").hidden = reel.count > 0;
    },
    onError: (err) => {
      if (err.status === 401) location.assign("/start");
      else $("[data-run-note]").textContent = `${err.message} Retrying…`;
    },
  });
})();
