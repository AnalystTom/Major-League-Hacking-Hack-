// Page wiring: the demo film, the shorts feed and the waitlist.

import { createFeed } from "./feed.js";
import { createFilm } from "./film.js";

const feed = createFeed(document.querySelector("[data-feed-root]"));
createFilm(document.querySelector("[data-film]")).refresh();
feed.refresh();

// Arrow keys drive the feed while it's on screen, without hijacking form fields.
let feedInView = false;
new IntersectionObserver(([e]) => (feedInView = e.isIntersecting), { threshold: 0.5 }).observe(feed.root);

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, [role='radiogroup']")) return;
  if (!feedInView && !feed.root.contains(document.activeElement)) return;
  if (feed.key(e)) e.preventDefault();
});

// "Join the waitlist" links jump to the hero form and put the cursor in the email field.
document.querySelectorAll('a[href="#join"]').forEach((a) =>
  a.addEventListener("click", () => {
    setTimeout(() => document.querySelector("#hero-email").focus({ preventScroll: true }), 350);
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

// ---------- Waitlist ----------

for (const form of document.querySelectorAll("[data-signup]")) {
  const status = form.querySelector(".form-status");
  const button = form.querySelector('button[type="submit"]');
  const emailInput = form.querySelector('input[type="email"]');
  const say = (text, tone) => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    if (!email || !emailInput.checkValidity()) {
      say("Enter an email address like you@example.com.", "error");
      emailInput.focus();
      return;
    }

    button.disabled = true;
    say("Joining…", "pending");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          agent: data.get("agent"),
          sources: data.getAll("sources"),
          company: data.get("company"),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "The waitlist is unavailable right now. Try again in a minute.");
      say(
        body.alreadyJoined
          ? "You're already on the list. We'll email you when your spot opens."
          : `You're on the list${body.position ? ` at #${body.position}` : ""}. We'll email you when your spot opens.`,
        "ok"
      );
      form.reset();
    } catch (err) {
      say(err.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}
