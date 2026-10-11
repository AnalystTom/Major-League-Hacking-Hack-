// Turns a pasted X (x.com / twitter.com) post link into the canonical URL an ingested unit stores.
// Kept free of Worker APIs so it can be unit tested with node --test.

const HOSTS = new Set(["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);

/** True for any x.com / twitter.com link, so the right "not a single post" error can be given. */
export function isXLink(input) {
  try {
    const submitted = typeof input === "string" ? input.trim() : "";
    return HOSTS.has(new URL(/^https?:\/\//i.test(submitted) ? submitted : `https://${submitted}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Returns { ok, value: { submitted_url, source_url, start_seconds: null, content_type } } or { ok: false, error }. */
export function parseXLink(input) {
  const submitted = typeof input === "string" ? input.trim() : "";
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(submitted) ? submitted : `https://${submitted}`);
  } catch {
    return { ok: false, error: "That isn't a link." };
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return { ok: false, error: "Only YouTube videos and X posts are supported for now." };
  const id = /^\/(?:i\/(?:web\/)?|\w{1,15}\/)status(?:es)?\/(\d{1,19})(?:\/|$)/.exec(url.pathname)?.[1];
  if (!id) return { ok: false, error: "That X link doesn't point at a single post." };
  return {
    ok: true,
    value: { submitted_url: submitted, source_url: `https://x.com/i/status/${id}`, start_seconds: null, content_type: "x_post" },
  };
}
