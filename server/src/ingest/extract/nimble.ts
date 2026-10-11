import type { TextSection, TextTranscript } from "../types.js";

export const NIMBLE_URL = "https://sdk.nimbleway.com/v2/extract";
const MAX_SECTIONS = 80;
const MAX_SECTION_CHARS = 1500;
const MIN_BODY_CHARS = 200;

// Substack's page chrome after the post body, and the notice shown in place of a paywalled body.
const END_MARKERS = [/^#+\s*Discussion about this post/im, /^Ready for more\?/im, /^#+\s*Subscribe to /im];
const PAYWALL = /(this post is for (paid|paying) subscribers|subscribe to (continue|keep) reading|upgrade to paid to (read|continue))/i;
const PAYWALLED = "this post is paywalled; only fully public posts can be imported";
// Lines that are page chrome rather than post text: buttons and share controls.
const CHROME = /^(subscribe|sign in|subscribe ?sign in|share|copy link|restack|like|comment|comments|leave a comment|reply)$/i;

/**
 * What the Nimble parser pulls out of a Substack page by CSS selector. Any field can be missing or empty when
 * Substack changes its markup; parsePost then falls back to the cleaned markdown.
 */
export const SUBSTACK_PARSER = {
  title: { type: "terminal", selector: { type: "css", css_selector: "h1.post-title" }, extractor: { type: "text", strip: true } },
  subtitle: { type: "terminal", selector: { type: "css", css_selector: "h3.subtitle" }, extractor: { type: "text", strip: true } },
  author: { type: "terminal", selector: { type: "css", css_selector: ".byline-names" }, extractor: { type: "text", strip: true } },
  body: { type: "terminal_list", selector: { type: "css", css_selector: "div.available-content div.body.markup > *" }, extractor: { type: "text", strip: true } },
  // Present only when Substack cuts the post off for non-subscribers.
  paywall: { type: "terminal", selector: { type: "css", css_selector: "div.paywall" }, extractor: { type: "text", strip: true } },
} as const;

export interface NimbleParsing { title?: unknown; subtitle?: unknown; author?: unknown; body?: unknown; paywall?: unknown }

export interface NimbleOptions {
  apiKey: string;
  sourceUrl: string;
  fetchImpl?: typeof fetch;
  retries?: number;
  /** Base delay before a retry, doubled each attempt (default 2000). */
  retryDelayMs?: number;
  timeoutMs?: number;
}

export interface NimbleExtraction { title: string | null; transcript: TextTranscript }

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null);

/** Plain text for one block: images and links reduced to their text, emphasis markers dropped, chrome and bare counters removed. */
export function cleanBlock(block: string): string {
  const text = block
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return !text || /^[-*_\s]+$/.test(text) || /^\d+$/.test(text) || CHROME.test(text) ? "" : text;
}

/** Numbers the non-empty blocks as sections, splitting any longer than MAX_SECTION_CHARS. */
export function toSections(blocks: string[]): TextSection[] {
  const out: string[] = [];
  for (const block of blocks) {
    const text = cleanBlock(block);
    for (let i = 0; i < text.length; i += MAX_SECTION_CHARS) out.push(text.slice(i, i + MAX_SECTION_CHARS));
  }
  return out.slice(0, MAX_SECTIONS).map((text, index) => ({ index, text }));
}

const charsOf = (sections: TextSection[]) => sections.reduce((n, s) => n + s.text.length, 0);

/** The post's own `# Title` heading. The publication header is a `# [![logo](...)](...)` heading that cleans to nothing, so it is skipped. */
function markdownTitle(markdown: string): { title: string; end: number } | null {
  for (const m of markdown.matchAll(/^#\s+(.+)$/gm)) {
    const title = cleanBlock(m[1]);
    if (title) return { title, end: m.index + m[0].length };
  }
  return null;
}

/** Drops the short non-heading blocks between the title and the first real paragraph (author, date, avatar). */
function withoutByline(blocks: string[]): string[] {
  const first = blocks.findIndex((b) => !/^#/.test(b.trim()) && cleanBlock(b).length >= 40);
  return first <= 0 ? blocks : blocks.filter((b, i) => i >= first || /^#/.test(b.trim()));
}

function overviewOf(p: NimbleParsing): string | undefined {
  const parts = [str(p.subtitle), str(p.author) && `By ${str(p.author)}.`].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * Turns Nimble's reply for a Substack page into a title and sections, or throws why the post is unusable.
 * Prefers the parser's selector results and falls back to the cleaned markdown when the body selector found nothing.
 * Any sign of a paywall rejects the post, however long the free preview is: a preview is not the post.
 */
export function parsePost(markdown: string, parsing: NimbleParsing = {}): NimbleExtraction {
  if (str(parsing.paywall) || PAYWALL.test(markdown)) throw new Error(PAYWALLED);

  const found = markdownTitle(markdown);
  let sections = toSections(Array.isArray(parsing.body) ? parsing.body.filter((b): b is string => typeof b === "string") : []);
  if (charsOf(sections) < MIN_BODY_CHARS) {
    let body = found ? markdown.slice(found.end) : markdown;
    const end = Math.min(...END_MARKERS.map((m) => m.exec(body)?.index ?? Infinity));
    if (Number.isFinite(end)) body = body.slice(0, end);
    sections = toSections(withoutByline(body.split(/\n\s*\n/)));
  }
  if (charsOf(sections) < MIN_BODY_CHARS) throw new Error("no readable post text was found on the page");
  return { title: str(parsing.title) ?? found?.title ?? null, transcript: { overview: overviewOf(parsing), sections } };
}

/** Fetches a public Substack post through Nimble. Retries 429/5xx and network errors; throws with the real failure detail. */
export async function extractWithNimble(o: NimbleOptions): Promise<NimbleExtraction> {
  const f = o.fetchImpl ?? fetch;
  const retries = o.retries ?? 2;
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, (o.retryDelayMs ?? 2000) * 2 ** (attempt - 1)));
    let res: Response;
    try {
      res = await f(NIMBLE_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({ url: o.sourceUrl, formats: ["markdown"], render: true, parse: true, parser: SUBSTACK_PARSER }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 90_000),
      });
    } catch (e) {
      lastError = `request failed: ${(e as Error).message}`;
      continue;
    }
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) { lastError = `Nimble HTTP ${res.status}: ${text.slice(0, 300)}`; continue; }
    if (!res.ok) throw new Error(`Nimble HTTP ${res.status}: ${text.slice(0, 300)}`);
    let body: { status?: string; status_code?: number; data?: { markdown?: string; parsing?: NimbleParsing } };
    try { body = JSON.parse(text); } catch { throw new Error("Nimble reply was not valid JSON"); }
    if (body.status === "failed") { lastError = `Nimble could not fetch the page (target status ${body.status_code ?? "unknown"})`; continue; }
    if (body.status_code && body.status_code >= 400) throw new Error(`the post returned HTTP ${body.status_code}${body.status_code === 404 ? " (not found or not public)" : ""}`);
    const markdown = body.data?.markdown;
    if (!markdown) throw new Error("Nimble returned no page content");
    return parsePost(markdown, body.data?.parsing ?? {});
  }
  throw new Error(lastError);
}
