export interface ParsedSourceUrl {
  contentType: "youtube_video" | "substack_post";
  submittedUrl: string;
  sourceUrl: string;
  startSeconds: number | null;
}

export interface ParsedYouTubeUrl {
  submittedUrl: string;
  sourceUrl: string;
  videoId: string;
  startSeconds: number | null;
}

const HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"]);

function parseStart(raw: string | null): number | null {
  if (!raw) return null;
  if (/^\d+s?$/.test(raw)) return parseInt(raw, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Canonicalize an individual YouTube link: drop list/index params, keep the video id and any start time. */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("not a valid URL");
  }
  if (!HOSTS.has(url.hostname)) throw new Error("not a YouTube or Substack URL");
  let videoId: string | null = null;
  if (url.hostname === "youtu.be") videoId = url.pathname.slice(1) || null;
  else if (url.pathname === "/watch") videoId = url.searchParams.get("v");
  else videoId = /^\/(?:shorts|embed)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) throw new Error("no valid video id found");
  return {
    submittedUrl: input,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    videoId,
    startSeconds: parseStart(url.searchParams.get("t") ?? url.searchParams.get("start")),
  };
}

const SUBSTACK_RESERVED = new Set(["www", "open", "on", "api", "support", "substack", "cdn", "email"]);
const PUB = /^[a-z0-9][a-z0-9-]*$/;
const SLUG = /^[\w-]+$/;

/** Canonicalize a Substack post link to https://<publication>.substack.com/p/<slug>, dropping tracking params. Custom domains are not recognized. */
export function parseSubstackUrl(input: string): ParsedSourceUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("not a valid URL");
  }
  const host = url.hostname.toLowerCase();
  let pub: string | undefined;
  let slug: string | undefined;
  if (host === "open.substack.com") [, pub, slug] = /^\/pub\/([^/]+)\/p\/([^/]+)/.exec(url.pathname) ?? [];
  else if (host.endsWith(".substack.com")) {
    pub = host.slice(0, -".substack.com".length);
    slug = /^\/p\/([^/]+)/.exec(url.pathname)?.[1];
  } else throw new Error("not a Substack URL");
  if (!pub || !slug || !PUB.test(pub) || SUBSTACK_RESERVED.has(pub) || !SLUG.test(slug)) throw new Error("no valid Substack post found (open the post and copy its address)");
  return { contentType: "substack_post", submittedUrl: input, sourceUrl: `https://${pub}.substack.com/p/${slug}`, startSeconds: null };
}

/** Recognizes any supported source link. */
export function parseSourceUrl(input: string): ParsedSourceUrl {
  let host = "";
  try { host = new URL(input.trim()).hostname.toLowerCase(); } catch { throw new Error("not a valid URL"); }
  if (host === "substack.com" || host.endsWith(".substack.com")) return parseSubstackUrl(input);
  const y = parseYouTubeUrl(input);
  return { contentType: "youtube_video", submittedUrl: y.submittedUrl, sourceUrl: y.sourceUrl, startSeconds: y.startSeconds };
}
