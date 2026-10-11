import type { TextSection, TextTranscript } from "../types.js";

export const NIMBLE_URL = "https://sdk.nimbleway.com/v2/extract";
const MAX_SECTIONS = 80;
const MAX_SECTION_CHARS = 1500;
const MIN_BODY_CHARS = 200;

// Substack's page chrome after the post body, and the notice shown in place of a paywalled body.
const END_MARKERS = [/^#+\s*Discussion about this post/im, /^Ready for more\?/im, /^#+\s*Subscribe to /im];
const PAYWALL = /(this post is for (paid|paying) subscribers|subscribe to (continue|keep) reading|upgrade to paid to (read|continue))/i;

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

/** Splits article markdown into numbered paragraph-sized sections, dropping image-only lines and splitting long paragraphs. */
export function toSections(markdown: string): TextSection[] {
  const out: string[] = [];
  for (const block of markdown.split(/\n\s*\n/)) {
    const text = block.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    if (!text || /^[-*_\s]+$/.test(text)) continue;
    for (let i = 0; i < text.length; i += MAX_SECTION_CHARS) out.push(text.slice(i, i + MAX_SECTION_CHARS));
  }
  return out.slice(0, MAX_SECTIONS).map((text, index) => ({ index, text }));
}

/** Turns Nimble's markdown for a Substack page into a title and sections, or throws why the post is unusable. */
export function parsePost(markdown: string): NimbleExtraction {
  const h1 = /^#\s+(.+)$/m.exec(markdown);
  const title = h1 ? h1[1].replace(/\s+/g, " ").trim() : null;
  let body = h1 ? markdown.slice(h1.index + h1[0].length) : markdown;
  const end = Math.min(...END_MARKERS.map((m) => m.exec(body)?.index ?? Infinity));
  if (Number.isFinite(end)) body = body.slice(0, end);
  const sections = toSections(body);
  const chars = sections.reduce((n, s) => n + s.text.length, 0);
  if (PAYWALL.test(markdown) && chars < 2000) throw new Error("this post is paywalled; only public posts can be imported");
  if (chars < MIN_BODY_CHARS) throw new Error("no readable post text was found on the page");
  return { title, transcript: { sections } };
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
        body: JSON.stringify({ url: o.sourceUrl, formats: ["markdown"], render: true }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 90_000),
      });
    } catch (e) {
      lastError = `request failed: ${(e as Error).message}`;
      continue;
    }
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) { lastError = `Nimble HTTP ${res.status}: ${text.slice(0, 300)}`; continue; }
    if (!res.ok) throw new Error(`Nimble HTTP ${res.status}: ${text.slice(0, 300)}`);
    let body: { status?: string; status_code?: number; data?: { markdown?: string } };
    try { body = JSON.parse(text); } catch { throw new Error("Nimble reply was not valid JSON"); }
    if (body.status === "failed") { lastError = `Nimble could not fetch the page (target status ${body.status_code ?? "unknown"})`; continue; }
    if (body.status_code && body.status_code >= 400) throw new Error(`the post returned HTTP ${body.status_code}${body.status_code === 404 ? " (not found or not public)" : ""}`);
    const markdown = body.data?.markdown;
    if (!markdown) throw new Error("Nimble returned no page content");
    return parsePost(markdown);
  }
  throw new Error(lastError);
}
