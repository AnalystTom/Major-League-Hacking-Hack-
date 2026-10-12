// Real video examples in the landing page's scrollable filmstrip.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createFeed(root) {
  const viewport = root.querySelector("[data-viewport]");
  const slides = [...root.querySelector("[data-track]").children];
  const prevBtn = root.querySelector("[data-prev]");
  const nextBtn = root.querySelector("[data-next]");
  const counter = root.querySelector("[data-counter]");
  let index = 0;

  function render() {
    slides.forEach((slide, i) => {
      slide.classList.toggle("is-active", i === index);
      if (i !== index) slide.querySelector("video").pause();
    });
    counter.textContent = `${index + 1} of ${slides.length}`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === slides.length - 1;
  }

  function offset(slide) {
    const rect = slide.getBoundingClientRect();
    return rect.left + rect.width / 2 - viewport.getBoundingClientRect().left - viewport.clientWidth / 2;
  }

  function go(delta) {
    const next = Math.min(slides.length - 1, Math.max(0, index + delta));
    viewport.scrollBy({ left: offset(slides[next]), behavior: reduceMotion ? "instant" : "smooth" });
  }

  viewport.addEventListener("scroll", () => {
    const next = slides.reduce((best, slide, i) => Math.abs(offset(slide)) < Math.abs(offset(slides[best])) ? i : best, 0);
    if (next !== index) { index = next; render(); }
  }, { passive: true });
  viewport.addEventListener("keydown", (e) => {
    // Preserve native video controls and link keyboard behavior.
    if (e.target !== viewport) return;
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else return;
    e.preventDefault();
  });
  prevBtn.addEventListener("click", () => go(-1));
  nextBtn.addEventListener("click", () => go(1));

  for (const slide of slides) {
    const video = slide.querySelector("video");
    video.addEventListener("play", () => {
      for (const other of slides) if (other !== slide) other.querySelector("video").pause();
    });
    // Capture also catches a failed URL's error on the nested <source>.
    video.addEventListener("error", () => {
      slide.querySelector(".example-error").hidden = false;
    }, true);
  }

  return { root, refresh: render };
}
