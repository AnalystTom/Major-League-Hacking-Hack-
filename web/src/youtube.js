// Turns a pasted YouTube link into the canonical watch URL and start time an ingested unit stores.
// Kept free of Worker APIs so it can be unit tested with node --test.

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

// "90", "90s", "1m30s", "1h2m3s" -> seconds; anything else -> null.
function parseStart(value) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Returns { ok, value: { submitted_url, source_url, start_seconds } } or { ok: false, error }. */
export function parseYouTubeLink(input) {
  const submitted = typeof input === "string" ? input.trim() : "";
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(submitted) ? submitted : `https://${submitted}`);
  } catch {
    return { ok: false, error: "That isn't a link." };
  }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return { ok: false, error: "Only YouTube video links are supported for now." };

  let id = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (url.pathname === "/watch") id = url.searchParams.get("v");
  else {
    const m = /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname);
    if (m) id = m[1];
  }
  if (!id || !ID.test(id)) return { ok: false, error: "That YouTube link doesn't point at a single video." };

  const start = parseStart(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return {
    ok: true,
    value: {
      submitted_url: submitted,
      source_url: `https://www.youtube.com/watch?v=${id}`,
      start_seconds: start,
    },
  };
}
