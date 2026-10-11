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
  if (!HOSTS.has(url.hostname)) throw new Error("not a YouTube URL");
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
