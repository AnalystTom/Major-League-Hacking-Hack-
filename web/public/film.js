// Hero demo film: scripted scenes with chapters, captions and play/pause.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createFilm(root) {
  const scenes = [...root.querySelectorAll("[data-scene]")];
  const chapters = [...root.querySelectorAll("[data-chapter]")];
  const caption = root.querySelector("[data-caption-out]");
  const toggle = root.querySelector("[data-toggle]");
  const SCENE_MS = 5600;
  let index = 0;
  let playing = !reduceMotion;
  let started = 0;
  let remaining = SCENE_MS;
  let timer = null;

  function countUp(el) {
    const to = Number(el.dataset.to);
    const fmt = el.dataset.format;
    const t0 = performance.now();
    const dur = reduceMotion ? 0 : 2200;
    const draw = (now) => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1;
      const v = Math.round(to * (1 - Math.pow(1 - p, 3)));
      el.textContent = fmt === "hm" ? `${Math.floor(v / 60)} h ${String(v % 60).padStart(2, "0")} m` : v.toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  function show(i) {
    index = i;
    scenes.forEach((s, j) => s.classList.toggle("is-on", j === i));
    chapters.forEach((c, j) => {
      c.setAttribute("aria-current", j === i ? "step" : "false");
      c.classList.toggle("done", j < i);
      c.classList.remove("run");
    });
    void chapters[i].offsetWidth;
    chapters[i].classList.add("run");
    caption.textContent = scenes[i].dataset.caption;
    scenes[i].querySelectorAll("[data-to]").forEach(countUp);
    remaining = SCENE_MS;
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    root.classList.toggle("paused", !playing);
    toggle.setAttribute("aria-label", playing ? "Pause demo" : "Play demo");
    toggle.dataset.state = playing ? "playing" : "paused";
    if (!playing) return;
    started = performance.now();
    timer = setTimeout(() => show((index + 1) % scenes.length), remaining);
  }

  toggle.addEventListener("click", () => {
    if (playing) remaining -= performance.now() - started;
    playing = !playing;
    schedule();
  });
  chapters.forEach((c, i) => c.addEventListener("click", () => show(i)));

  return { refresh: () => show(index) };
}
