// Turns a pasted Substack post link into the canonical post URL an ingested unit stores.
// Only public *.substack.com posts are recognized (custom domains can't be told apart from other sites).
// Kept free of Worker APIs so it can be unit tested with node --test.

const RESERVED = new Set(["www", "open", "on", "api", "support", "substack", "cdn", "email"]);
const PUB = /^[a-z0-9][a-z0-9-]*$/;
const SLUG = /^[\w-]+$/;

export const isSubstackHost = (host) => host === "substack.com" || host.endsWith(".substack.com");

/** Returns { ok, value: { submitted_url, source_url, start_seconds, content_type } } or { ok: false, error }. */
export function parseSubstackLink(input) {
  const submitted = typeof input === "string" ? input.trim() : "";
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(submitted) ? submitted : `https://${submitted}`);
  } catch {
    return { ok: false, error: "That isn't a link." };
  }
  const host = url.hostname.toLowerCase();
  let pub;
  let slug;
  if (host === "open.substack.com") [, pub, slug] = /^\/pub\/([^/]+)\/p\/([^/]+)/.exec(url.pathname) ?? [];
  else if (host.endsWith(".substack.com")) {
    pub = host.slice(0, -".substack.com".length);
    slug = /^\/p\/([^/]+)/.exec(url.pathname)?.[1];
  }
  if (!pub || !slug || !PUB.test(pub) || RESERVED.has(pub) || !SLUG.test(slug)) {
    return { ok: false, error: "That Substack link doesn't point at a single post. Open the post and copy its address." };
  }
  return {
    ok: true,
    value: { submitted_url: submitted, source_url: `https://${pub}.substack.com/p/${slug}`, start_seconds: null, content_type: "substack_post" },
  };
}
