// Shorts feed controller: a horizontal filmstrip where the centred short plays.

import { SHORTS, shortMarkup, skillMarkdown } from "./shorts.js";

const SCENE_MS = 6500;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createFeed(root) {
  const viewport = root.querySelector("[data-viewport]");
  const track = root.querySelector("[data-track]");
  const prevBtn = root.querySelector("[data-prev]");
  const nextBtn = root.querySelector("[data-next]");
  const sendBtn = root.querySelector("[data-send]");
  const copyBtn = root.querySelector("[data-copy]");
  const status = root.querySelector("[data-feed-status]");
  const counter = root.querySelector("[data-counter]");
  const why = root.querySelector("[data-why]");

  track.innerHTML = SHORTS.map(shortMarkup).join("");
  const slides = [...track.children];

  let index = 0;
  let loop = null;
  let copiedTimer = null;
  const sent = new Set();

  function play(slide) {
    slide.classList.remove("play");
    void slide.offsetWidth; // restart CSS animations
    slide.classList.add("play");
  }

  function position() {
    const slide = slides[index];
    const offset = slide.offsetLeft + slide.offsetWidth / 2 - viewport.clientWidth / 2;
    track.style.transform = `translateX(${-offset}px)`;
  }

  function render() {
    slides.forEach((s, i) => {
      s.classList.toggle("is-active", i === index);
      s.classList.toggle("is-near", Math.abs(i - index) === 1);
      s.setAttribute("aria-hidden", String(i !== index));
      if (i !== index) s.classList.remove("play");
    });
    position();
    const short = SHORTS[index];
    counter.textContent = `${index + 1} of ${SHORTS.length}`;
    why.textContent = short.why;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === SHORTS.length - 1;
    const isSent = sent.has(short.id);
    sendBtn.disabled = isSent;
    sendBtn.textContent = isSent ? "Sent to your agents" : "Send to your agents";
    resetCopy();

    clearInterval(loop);
    play(slides[index]);
    if (!reduceMotion) loop = setInterval(() => play(slides[index]), SCENE_MS);
  }

  function go(delta) {
    const next = Math.min(SHORTS.length - 1, Math.max(0, index + delta));
    if (next === index) return;
    index = next;
    render();
  }

  function send() {
    const short = SHORTS[index];
    if (sent.has(short.id)) return;
    sent.add(short.id);
    slides[index].dataset.sent = "";
    if (index < SHORTS.length - 1) setTimeout(() => go(1), reduceMotion ? 0 : 650);
    else render();
  }

  function resetCopy() {
    clearTimeout(copiedTimer);
    copyBtn.textContent = "Copy to clipboard";
  }

  // Copies the current short as a SKILL.md any agent can read.
  async function copy() {
    const text = skillMarkdown(SHORTS[index]);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = Object.assign(document.createElement("textarea"), { value: text });
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (!ok) {
        status.textContent = "Your browser blocked copying. Select the text on the short instead.";
        return;
      }
    }
    copyBtn.textContent = "Copied";
    status.textContent = "Copied as a SKILL.md. Paste it into your agent's skills folder.";
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(resetCopy, 2000);
  }

  prevBtn.addEventListener("click", () => go(-1));
  nextBtn.addEventListener("click", () => go(1));
  sendBtn.addEventListener("click", send);
  copyBtn.addEventListener("click", copy);

  // Clicking a neighbouring short in the filmstrip brings it to the centre.
  track.addEventListener("click", (e) => {
    const slide = e.target.closest(".short");
    const i = slides.indexOf(slide);
    if (i >= 0 && i !== index) go(i - index);
  });

  // Swipe left or right.
  let start = null;
  viewport.addEventListener("pointerdown", (e) => (start = { x: e.clientX }));
  viewport.addEventListener("pointerup", (e) => {
    if (!start) return;
    const d = e.clientX - start.x;
    start = null;
    if (Math.abs(d) > 50) go(d < 0 ? 1 : -1);
  });

  window.addEventListener("resize", position);

  return {
    root,
    refresh: render,
    key(e) {
      if (["ArrowDown", "ArrowRight"].includes(e.key)) go(1);
      else if (["ArrowUp", "ArrowLeft"].includes(e.key)) go(-1);
      else return false;
      return true;
    },
  };
}
