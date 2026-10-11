// Hero demo film: a scripted story in scenes, with chapters, a timecode, captions and play/pause.
// Scenes are drawn on a fixed-size canvas that's scaled to fit the screen, so each one keeps its
// composition at any width. The film holds its place while it's scrolled out of view.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function createFilm(root) {
  const screen = root.querySelector("[data-screen]");
  const canvas = root.querySelector("[data-canvas]");
  const scenes = [...root.querySelectorAll("[data-scene]")];
  const chapters = [...root.querySelectorAll("[data-chapter]")];
  const caption = root.querySelector("[data-caption-out]");
  const toggle = root.querySelector("[data-toggle]");
  const timeOut = root.querySelector("[data-time]");
  const lengths = scenes.map((s) => Number(s.dataset.ms) || 6000);
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  const total = clock(Math.ceil((starts.at(-1) + lengths.at(-1)) / 1000) * 1000);
  let index = 0;
  let playing = !reduceMotion;
  let inView = true;
  let started = 0;
  let remaining = lengths[0];
  let timer = null;

  const running = () => playing && inView;

  const fit = () => root.style.setProperty("--k", screen.clientWidth / canvas.offsetWidth);
  new ResizeObserver(fit).observe(screen);
  fit();

  function countUp(el) {
    const to = Number(el.dataset.to);
    const t0 = performance.now();
    const dur = reduceMotion ? 0 : 2200;
    const draw = (now) => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1;
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }

  function show(i) {
    index = i;
    scenes.forEach((s) => s.classList.remove("is-on"));
    void canvas.offsetWidth; // restarts the scene's animations, even when replaying the same one
    scenes[i].classList.add("is-on");
    chapters.forEach((c, j) => {
      c.setAttribute("aria-current", j === i ? "step" : "false");
      c.classList.toggle("done", j < i);
      c.classList.remove("run");
    });
    chapters[i].style.setProperty("--dur", `${lengths[i]}ms`);
    void chapters[i].offsetWidth;
    chapters[i].classList.add("run");
    caption.textContent = scenes[i].dataset.caption;
    scenes[i].querySelectorAll("[data-to]").forEach(countUp);
    remaining = lengths[i];
    schedule();
  }

  // Bank the time already played in this scene before stopping or restarting the clock.
  function hold() {
    if (running()) remaining -= performance.now() - started;
  }

  function schedule() {
    clearTimeout(timer);
    // With reduced motion every scene already shows its end state; freezing it would show the start.
    root.classList.toggle("paused", !running() && !reduceMotion);
    toggle.setAttribute("aria-label", playing ? "Pause demo" : "Play demo");
    toggle.dataset.state = playing ? "playing" : "paused";
    if (running()) {
      started = performance.now();
      timer = setTimeout(() => show((index + 1) % scenes.length), remaining);
    }
    tick();
  }

  function tick() {
    const into = lengths[index] - remaining + (running() ? performance.now() - started : 0);
    timeOut.textContent = `${clock(starts[index] + Math.min(into, lengths[index]))} / ${total}`;
  }
  setInterval(() => running() && tick(), 250);

  toggle.addEventListener("click", () => {
    hold();
    playing = !playing;
    schedule();
  });
  chapters.forEach((c, i) =>
    c.addEventListener("click", () => {
      if (!reduceMotion) playing = true;
      show(i);
    }),
  );
  new IntersectionObserver(
    ([e]) => {
      hold();
      inView = e.isIntersecting;
      schedule();
    },
    { threshold: 0.25 },
  ).observe(screen);

  return { refresh: () => show(index) };
}
