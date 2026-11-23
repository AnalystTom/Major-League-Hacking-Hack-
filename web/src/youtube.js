import { SUBSTACK_SUPPORTED } from "./substack.js";

export const UNSUPPORTED_LINK = SUBSTACK_SUPPORTED
  ? "Only YouTube videos, X posts and Substack posts on a substack.com address are supported for now."
  : "Only YouTube videos and X posts are supported for now.";

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

function parseStart(value) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export function parseYouTubeLink(input) {
  const submitted = typeof input === "string" ? input.trim() : "";
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(submitted) ? submitted : `https://${submitted}`);
  } catch {
    return { ok: false, error: "That isn't a link." };
  }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return { ok: false, error: UNSUPPORTED_LINK };

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
