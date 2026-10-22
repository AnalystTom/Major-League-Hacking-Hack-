// The reel: rendered shorts in a vertical, snap-scrolling column. One clip plays at a time, muted
// until the viewer turns sound on. Every string from the API goes in through textContent.

import { skillAnchor } from "./agents.js";
import { el } from "./dom.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SKILL_LABEL = {
  pending: "Skill queued",
  running: "Skill being written",
  failed: "Skill failed",
  regenerating: "Skill being regenerated",
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
      for (const e of entries) if (e.isIntersecting && e.target.parentElement === track) activate(Number(e.target.dataset.index));
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
    // Legacy caption tracks only: new judged shorts already contain visible burned subtitles.
    const caption = el("p", { class: "reel-caption", "aria-hidden": "true" });
    if (item.video.captions_url && !item.video.subtitles_burned) {
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
      el("button", { type: "button", class: "reel-btn", text: "Try again", onclick: () => { failed.hidden = true; video.load(); if (Number(slide.dataset.index) === active) play(video); } })
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
      item.selection_reason ? el("p", { class: "reel-reason", text: item.selection_reason }) : null,
      el("ul", {}, ...sources.map((s) =>
        el("li", {}, el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", text: s.title || hostOf(s.url) }))
      ))
    );

    const soundBtn = el("button", { type: "button", class: "reel-btn reel-sound", "data-sound": true, "aria-pressed": String(soundOn), text: soundOn ? "Sound on" : "Tap for sound" });
    const slide = el("article", { class: "reel-item", "data-index": String(index), "aria-label": item.name },
      el("div", { class: "reel-stage" },
        el("div", { class: "reel-picture" },
          el("div", { class: "reel-progress" }, progress), video, caption, failed
        )
      ),
      el("div", { class: "reel-details" },
        el("div", { class: "reel-tags" }),
        el("h3", { class: "reel-title", text: item.name }),
        sheet,
        el("div", { class: "reel-actions" },
          soundBtn,
          el("button", { type: "button", class: "reel-btn", "aria-expanded": "false", text: "View sources",
            onclick: (e) => { sheet.hidden = !sheet.hidden; e.currentTarget.setAttribute("aria-expanded", String(!sheet.hidden)); } }),
          el("button", { type: "button", class: "reel-btn", text: "Skip", onclick: () => go(1) })
        )
      )
    );

    // Tapping the picture pauses or resumes; the buttons handle their own clicks.
    video.addEventListener("click", () => (video.paused ? play(video) : video.pause()));
    soundBtn.addEventListener("click", () => setSound(!soundOn));
    return slide;
  }

  function updateSkill(slide, item) {
    slide.querySelector(".reel-tags").replaceChildren(
      ...(item.category ? [el("span", { class: "reel-chip", text: item.category })] : []),
      ...[skillChip(item.skill)].filter(Boolean)
    );
    const link = slide.querySelector(".reel-skill");
    if (item.skill?.status !== "ready") link?.remove();
    else if (!link) {
      const actions = slide.querySelector(".reel-actions");
      actions.insertBefore(el("a", { class: "reel-btn reel-skill", href: `#${skillAnchor(item.id, item.version)}`, text: "View skill" }), actions.lastElementChild);
    }
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
    /** Reconcile revisions as well as additions, so polling cannot retain a hidden duplicate. */
    render(next) {
      const keyOf = (item) => `${item.id}:${item.version}`;
      if (JSON.stringify(next) === JSON.stringify(items)) return;
      const current = items[active] && keyOf(items[active]);
      const currentSlide = shown.get(current);
      const previous = new Map(items.map((item) => [keyOf(item), item]));
      const offset = track.scrollTop - Math.max(0, active) * track.clientHeight;
      observer.disconnect();
      const keys = new Set(next.map(keyOf));
      for (const [key, slide] of shown) if (!keys.has(key)) {
        slide.querySelector("video")?.pause();
        slide.remove();
        shown.delete(key);
      }
      items = next;
      const slides = items.map((item, index) => {
        let slide = shown.get(keyOf(item));
        const video = previous.get(keyOf(item))?.video;
        if (slide && (video.url !== item.video.url || video.captions_url !== item.video.captions_url || video.subtitles_burned !== item.video.subtitles_burned)) {
          slide.querySelector("video")?.pause();
          slide.remove();
          slide = null;
        }
        slide ??= slideFor(item, index);
        slide.dataset.index = String(index);
        updateSkill(slide, item);
        shown.set(keyOf(item), slide);
        return slide;
      });
      let before = null;
      for (const slide of [...slides].reverse()) {
        if (slide !== currentSlide && (slide.parentElement !== track || slide.nextSibling !== before)) track.insertBefore(slide, before);
        before = slide;
      }
      slides.forEach((slide) => observer.observe(slide));
      root.hidden = items.length === 0;
      if (items.length) {
        const index = items.findIndex((item) => keyOf(item) === current);
        if (index >= 0 && slides[index] === currentSlide) {
          active = index;
          counter.textContent = `${index + 1} of ${items.length}`;
          track.scrollTop = index * track.clientHeight + offset;
        } else {
          active = -1;
          activate(Math.max(0, index));
          track.scrollTop = Math.max(0, index) * track.clientHeight;
        }
      } else {
        active = -1;
        counter.textContent = "";
      }
    },
    get count() {
      return items.length;
    },
  };
}
