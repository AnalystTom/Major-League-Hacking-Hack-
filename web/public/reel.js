// The reel: rendered shorts in a vertical, snap-scrolling column. One clip plays at a time, muted
// until the viewer turns sound on. Every string from the API goes in through textContent.

import { skillAnchor } from "./agents.js";
import { el } from "./dom.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SKILL_LABEL = {
  pending: "Skill queued",
  running: "Skill being written",
  failed: "Skill failed",
};

function skillChip(skill) {
  if (!skill) return null;
  const ready = skill.status === "ready";
  const label = ready ? "Skill ready" : SKILL_LABEL[skill.status];
  return label ? el("span", { class: "reel-chip", "data-ready": ready ? "true" : null, text: label }) : null;
}

// Source URLs come from processor and model output; anything but http(s) (javascript:, data:) is dropped.
const safeHref = (u) => {
  try {
    const url = new URL(u, location.href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export function createReel(root) {
  const track = root.querySelector("[data-reel-track]");
  const counter = root.querySelector("[data-reel-counter]");
  let items = [];
  let active = -1;
  let soundOn = false;
  const shown = new Map(); // `${id}:${version}` -> slide

  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) activate(Number(e.target.dataset.index));
    },
    { root: track, threshold: 0.6 }
  );

  function slideFor(item, index) {
    const video = el("video", {
      src: item.video.url,
      playsinline: true,
      muted: true,
      loop: true,
      preload: index === 0 ? "auto" : "metadata",
      crossorigin: item.video.captions_url && /^https?:/.test(item.video.url) ? "anonymous" : null,
    });
    video.muted = true;
    // The browser times the WebVTT cues; the reel draws them itself, above the title and buttons and
    // wrapped to the frame, which native cue rendering won't reliably do in a 9:16 crop.
    const caption = el("p", { class: "reel-caption", "aria-hidden": "true" });
    if (item.video.captions_url) {
      const track = el("track", { kind: "captions", srclang: "en", label: "English", src: item.video.captions_url, default: true });
      video.append(track);
      track.track.mode = "hidden";
      track.track.addEventListener("cuechange", () => {
        caption.textContent = [...(track.track.activeCues ?? [])].map((c) => c.text).join("\n");
      });
    }

    const progress = el("i");
    const failed = el("div", { class: "reel-failed", hidden: true },
      el("p", { text: "This clip couldn't play." }),
      el("button", { type: "button", class: "reel-btn", text: "Try again", onclick: () => { failed.hidden = true; video.load(); if (index === active) play(video); } })
    );
    video.addEventListener("error", () => (failed.hidden = false));
    video.addEventListener("timeupdate", () => {
      if (video.duration) progress.style.transform = `scaleX(${video.currentTime / video.duration})`;
    });

    const sources = (item.sources?.length ? item.sources : [{ url: item.source_url }])
      .map((s) => ({ ...s, url: safeHref(s?.url) }))
      .filter((s) => s.url);
    const sheet = el("div", { class: "reel-sources", hidden: true },
      el("p", { class: "reel-sources-head", text: "Sources" }),
      el("ul", {}, ...sources.map((s) =>
        el("li", {}, el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", text: s.title || hostOf(s.url) }))
      ))
    );

    const soundBtn = el("button", { type: "button", class: "reel-btn reel-sound", "data-sound": true, "aria-pressed": String(soundOn), text: soundOn ? "Sound on" : "Tap for sound" });
    const slide = el("article", { class: "reel-item", "data-index": String(index), "aria-label": item.name },
      el("div", { class: "reel-progress" }, progress),
      video,
      caption,
      failed,
      el("div", { class: "reel-overlay" },
        el("div", { class: "reel-tags" },
          item.category ? el("span", { class: "reel-chip", text: item.category }) : null,
          skillChip(item.skill)
        ),
        el("h3", { class: "reel-title", text: item.name }),
        item.selection_reason ? el("p", { class: "reel-reason", text: item.selection_reason }) : null,
        sheet,
        el("div", { class: "reel-actions" },
          soundBtn,
          el("button", { type: "button", class: "reel-btn", "aria-expanded": "false", text: "View sources",
            onclick: (e) => { sheet.hidden = !sheet.hidden; e.currentTarget.setAttribute("aria-expanded", String(!sheet.hidden)); } }),
          // The skill and its tasks open in a sheet over the reel; only a ready skill gets a way there.
          item.skill?.status === "ready"
            ? el("a", { class: "reel-btn", href: `#${skillAnchor(item.id, item.version)}`, text: "View skill & tasks" })
            : null,
          el("button", { type: "button", class: "reel-btn", text: "Skip", onclick: () => go(1) })
        )
      )
    );

    // Tapping the picture pauses or resumes; the buttons handle their own clicks.
    video.addEventListener("click", () => (video.paused ? play(video) : video.pause()));
    soundBtn.addEventListener("click", () => setSound(!soundOn));
    return slide;
  }

  function play(video) {
    video.muted = !soundOn;
    const p = video.play();
    // Browsers may block unmuted autoplay; fall back to muted rather than leaving a frozen frame.
    if (p) p.catch(() => { if (!video.muted) { video.muted = true; setSound(false); video.play().catch(() => {}); } });
  }

  function setSound(on) {
    soundOn = on;
    track.querySelectorAll("[data-sound]").forEach((b) => {
      b.setAttribute("aria-pressed", String(on));
      b.textContent = on ? "Sound on" : "Tap for sound";
    });
    const v = track.children[active]?.querySelector("video");
    if (v) v.muted = !on;
  }

  function activate(index) {
    if (index === active) return;
    active = index;
    [...track.children].forEach((slide, i) => {
      const v = slide.querySelector("video");
      if (!v) return;
      if (i === index) {
        if (!reduceMotion || soundOn) play(v);
      } else v.pause();
    });
    counter.textContent = items.length ? `${index + 1} of ${items.length}` : "";
  }

  function go(delta) {
    const next = Math.min(items.length - 1, Math.max(0, active + delta));
    track.children[next]?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  }

  track.addEventListener("keydown", (e) => {
    if (["ArrowDown", "j", "PageDown"].includes(e.key)) go(1);
    else if (["ArrowUp", "k", "PageUp"].includes(e.key)) go(-1);
    else if (e.key === "m") setSound(!soundOn);
    else return;
    e.preventDefault();
  });

  return {
    root,
    /** Appends clips that weren't shown yet, keeping the one playing in place. */
    render(next) {
      for (const item of next) {
        const key = `${item.id}:${item.version}`;
        if (shown.has(key)) continue;
        const slide = slideFor(item, items.length);
        items.push(item);
        shown.set(key, slide);
        track.append(slide);
        observer.observe(slide);
      }
      root.hidden = items.length === 0;
      if (active === -1 && items.length) activate(0);
      else counter.textContent = items.length ? `${active + 1} of ${items.length}` : "";
    },
    get count() {
      return items.length;
    },
  };
}
