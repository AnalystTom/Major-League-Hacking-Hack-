// Page wiring: the demo film, the sample shorts feed, and the Get started call to action.

import { createFeed } from "./feed.js";
import { createFilm } from "./film.js";

const feed = createFeed(document.querySelector("[data-feed-root]"));
createFilm(document.querySelector("[data-film]")).refresh();
feed.refresh();

// Arrow keys drive the feed while it's on screen, without hijacking form fields.
let feedInView = false;
new IntersectionObserver(([e]) => (feedInView = e.isIntersecting), { threshold: 0.5 }).observe(feed.root);

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, [role='radiogroup'], [data-reel-track]")) return;
  if (!feedInView && !feed.root.contains(document.activeElement)) return;
  if (feed.key(e)) e.preventDefault();
});


// ---------- Colour palette picker (shown with ?pick) ----------

const picker = document.querySelector("[data-palette-picker]");
const params = new URLSearchParams(location.search);
if (params.has("pick")) picker.hidden = false;

function markPalette() {
  picker.querySelectorAll("[data-pick-palette]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.pickPalette === document.documentElement.dataset.palette));
  });
}
picker.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pick-palette]");
  if (!b) return;
  document.documentElement.dataset.palette = b.dataset.pickPalette;
  try {
    localStorage.setItem("resurface-palette", b.dataset.pickPalette);
  } catch {}
  params.set("palette", b.dataset.pickPalette);
  history.replaceState(null, "", `?${params}`);
  markPalette();
});
markPalette();

// ---------- Get started ----------

// Signed-in visitors go straight to their feed instead of onboarding.
fetch("/api/me", { credentials: "same-origin" })
  .then((res) => (res.ok ? res.json() : null))
  .then((me) => {
    if (!me?.user) return;
    const to = me.step === "done" ? "/app" : `/start#${me.step}`;
    document.querySelectorAll("[data-cta]").forEach((a) => {
      a.href = to;
      a.textContent = me.step === "done" ? "Open your feed" : "Finish setting up";
    });
    document.querySelector("[data-signin-link]")?.remove();
  })
  .catch(() => {});
