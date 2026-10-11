// Proceed: send pasted YouTube links to /api/imports, follow each one through processing, and hand
// approved, rendered shorts to the reel. The unit ids live in ?units= so a refresh picks up where it was.

const POLL_MS = 4000;
const REVIEW_POLL_MS = 15000;

const STAGE = {
  queued: "Queued",
  fetching: "Reading the video",
  digesting: "Picking out what's useful",
  rendering: "Rendering the short",
  in_review: "Rendered, waiting for a teammate to approve it",
  ready: "Ready to watch",
  failed: "Couldn't read this video",
  render_failed: "Rendering failed",
  rejected: "Rejected in review",
  not_selected: "Nothing in it fit the project",
};

const PROCESSOR = {
  requested: "Processing started. This page updates as each video moves along.",
  not_needed: "These videos were imported before, so you're seeing their current state.",
  not_configured: "Your links are saved. The processing service isn't connected yet, so they're waiting in the queue.",
  unavailable: "Your links are saved, but the processing service didn't answer. They're waiting in the queue.",
};

async function getJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || "Something went wrong. Try again in a minute.");
    err.invalid = body.invalid;
    err.status = res.status;
    throw err;
  }
  return body;
}

export function createProceed({ form, run, reel }) {
  const status = form.querySelector(".form-status");
  const button = form.querySelector('button[type="submit"]');
  const textarea = form.querySelector("textarea");
  const list = run.querySelector("[data-units]");
  const note = run.querySelector("[data-run-note]");
  const recheck = run.querySelector("[data-recheck]");
  const empty = run.querySelector("[data-reel-empty]");

  let ids = [];
  let timer = null;

  const say = (text, tone) => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  function renderUnits(units) {
    list.replaceChildren(
      ...units.map((u) => {
        const li = document.createElement("li");
        li.dataset.stage = u.stage;
        const name = document.createElement("a");
        if (/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(u.source_url)) name.href = u.source_url;
        name.target = "_blank";
        name.rel = "noopener noreferrer";
        name.textContent = u.title || u.source_url.replace(/^https:\/\/www\./, "");
        const stage = document.createElement("span");
        stage.className = "unit-stage";
        stage.textContent = STAGE[u.stage] ?? u.stage;
        li.append(name, stage);
        const failed = ["failed", "render_failed", "not_selected"].includes(u.stage);
        if (u.error || failed) {
          const why = document.createElement("p");
          why.className = "unit-error";
          why.textContent = u.error || "Reason unknown.";
          li.append(why);
        }
        return li;
      })
    );
  }

  async function refresh() {
    clearTimeout(timer);
    const q = ids.join(",");
    try {
      const [{ units }, { items }] = await Promise.all([
        getJson(`/api/imports?units=${q}`),
        getJson(`/api/feed?units=${q}`),
      ]);
      renderUnits(units);
      reel.render(items);
      const waiting = units.some((u) => !u.settled);
      const inReview = units.some((u) => u.stage === "in_review");
      empty.hidden = reel.count > 0 || waiting || inReview;
      recheck.hidden = waiting || !inReview;
      // Approval can land any time, so keep checking slowly while a clip awaits review.
      const delay = waiting ? POLL_MS : inReview ? REVIEW_POLL_MS : null;
      if (delay) timer = setTimeout(refresh, document.hidden ? delay * 4 : delay);
    } catch (err) {
      // A bad id list won't fix itself; anything else is worth another try.
      if (err.status === 400) return void (note.textContent = "That link to an import isn't valid. Paste your links again.");
      note.textContent = `${err.message} Retrying…`;
      timer = setTimeout(refresh, POLL_MS * 3);
    }
  }

  function follow(nextIds, message) {
    ids = nextIds;
    run.hidden = false;
    note.textContent = message ?? "";
    const params = new URLSearchParams(location.search);
    params.set("units", ids.join(","));
    history.replaceState(null, "", `?${params}#run`);
    refresh();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const links = String(data.get("links") || "").split(/\s+/).filter(Boolean);
    if (links.length === 0) {
      say("Paste at least one YouTube link.", "error");
      textarea.focus();
      return;
    }

    button.disabled = true;
    say("Sending…", "pending");
    try {
      const body = await getJson("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ links, company: data.get("company") }),
      });
      if (body.units.length === 0) return say("", "ok");
      say(`${body.units.length} ${body.units.length === 1 ? "video" : "videos"} sent.`, "ok");
      renderUnits(body.units);
      follow(body.units.map((u) => u.id), PROCESSOR[body.processor]);
      run.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      const detail = err.invalid?.map((i) => `${i.link}: ${i.error}`).join(" ");
      say(detail ? `${err.message} ${detail}` : err.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  recheck.addEventListener("click", refresh);

  // Pick up a run from the address bar after a refresh or a shared link.
  const resumed = (new URLSearchParams(location.search).get("units") ?? "").split(",").filter(Boolean);
  if (resumed.length) follow(resumed);
}
