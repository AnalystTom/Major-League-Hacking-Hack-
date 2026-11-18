import { UNSUPPORTED_LINK } from "./youtube.js";

const HOSTS = new Set(["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);

export function isXLink(input) {
  try {
    const submitted = typeof input === "string" ? input.trim() : "";
    return HOSTS.has(new URL(/^https?:\/\//i.test(submitted) ? submitted : `https://${submitted}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function parseXLink(input) {
  const submitted = typeof input === "string" ? input.trim() : "";
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(submitted) ? submitted : `https://${submitted}`);
  } catch {
    return { ok: false, error: "That isn't a link." };
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return { ok: false, error: UNSUPPORTED_LINK };
  const id = /^\/(?:i\/(?:web\/)?|\w{1,15}\/)status(?:es)?\/(\d{1,19})(?:\/|$)/.exec(url.pathname)?.[1];
  if (!id) return { ok: false, error: "That X link doesn't point at a single post." };
  return {
    ok: true,
    value: { submitted_url: submitted, source_url: `https://x.com/i/status/${id}`, start_seconds: null, content_type: "x_post" },
  };
}
