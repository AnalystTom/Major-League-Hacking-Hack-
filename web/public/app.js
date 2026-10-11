// Page wiring: the demo film, the sample shorts feed, and Proceed with its reel.

import { createFeed } from "./feed.js";
import { createFilm } from "./film.js";
import { createProceed } from "./proceed.js";
import { createReel } from "./reel.js";

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

// "Proceed" links jump to the hero form and put the cursor in the links box.
document.querySelectorAll('a[href="#proceed"]').forEach((a) =>
  a.addEventListener("click", () => {
    setTimeout(() => document.querySelector("#proceed-links").focus({ preventScroll: true }), 350);
  })
);

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

// ---------- Proceed ----------

createProceed({
  form: document.querySelector("[data-proceed]"),
  run: document.querySelector("[data-run]"),
  reel: createReel(document.querySelector("[data-reel]")),
});
