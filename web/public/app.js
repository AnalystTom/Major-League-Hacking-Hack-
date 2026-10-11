// Page wiring: the demo film, the palette picker, and the Get started buttons.

import { createFilm } from "./film.js";

createFilm(document.querySelector("[data-film]")).refresh();

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

// Signed-in visitors go straight to their feed instead of sign-up.
fetch("/api/me", { credentials: "same-origin" })
  .then((res) => (res.ok ? res.json() : null))
  .then((me) => {
    if (!me?.user) return;
    document.querySelectorAll("[data-cta]").forEach((a) => {
      a.href = "/app";
      a.textContent = "Open your feed";
    });
    document.querySelector("[data-signin-link]")?.remove();
  })
  .catch(() => {});
