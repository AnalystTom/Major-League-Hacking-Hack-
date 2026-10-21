import { httpError } from "../../httpError.js";
import type { EvidenceItem, IngestedUnit } from "../types.js";

export const X_POST_METHOD = "twitterapi.io:tweets";
export const X_PUBLIC_METHOD = "x-embed:tweet-result";
export const UNAVAILABLE = "X post unavailable: not found, deleted or protected";

interface TwitterApiTweet {
  id: string;
  text?: string;
  createdAt?: string;
  author?: { userName?: string; name?: string; unavailable?: boolean; unavailableReason?: string };
  quoted_tweet?: { text?: string; author?: { userName?: string } } | null;
}

/**
 * twitterapi.io's free tier allows one request every 5 seconds. Calls are spaced process-wide, and a 429 is retried
 * after the wait the API asks for (Retry-After) or one interval, so a batch of X links settles instead of failing.
 * TWITTERAPI_MIN_INTERVAL_MS overrides the spacing (0 disables it, for tests or a paid plan).
 */
const DEFAULT_INTERVAL_MS = 5_200;
const MAX_RETRIES = 3;
let gate: Promise<void> = Promise.resolve();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const intervalMs = () => {
  const n = Number(process.env.TWITTERAPI_MIN_INTERVAL_MS);
  return process.env.TWITTERAPI_MIN_INTERVAL_MS !== undefined && Number.isFinite(n) && n >= 0 ? n : DEFAULT_INTERVAL_MS;
};

/** Runs `fn` after the previous call's slot has passed; each caller holds the next slot for one interval. */
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const turn = gate;
  gate = turn.then(() => sleep(intervalMs()));
  return turn.then(fn);
}

function retryAfterMs(res: Response): number {
  const s = Number(res.headers.get("retry-after"));
  return Number.isFinite(s) && s > 0 ? Math.min(s * 1000, 30_000) : intervalMs();
}

interface TwitterApiArticle {
  title?: string;
  preview_text?: string;
  contents?: { type?: string; text?: string }[];
}

/** Longest article text kept, so one very long article can't crowd every other source out of a digest. */
const MAX_ARTICLE_CHARS = 20_000;

/** A post whose text is only links (t.co): how X shows a long-form Article, whose body lives elsewhere. */
const onlyLinks = (text: string) => text.replace(/https?:\/\/\S+/g, "").trim() === "";

/** One paced GET, retrying a 429 after the wait the API asks for, up to MAX_RETRIES times. */
async function pacedGet(get: () => Promise<Response>): Promise<Response> {
  let res = await paced(get);
  for (let attempt = 0; res.status === 429 && attempt < MAX_RETRIES; attempt++) {
    const wait = retryAfterMs(res);
    await res.text().catch(() => "");
    await sleep(wait);
    res = await paced(get);
  }
  return res;
}

/** Reads the post's X Article (GET /twitter/article); null when the post has none. Other failures throw. */
async function readArticle(o: XPostOptions, get: (url: string) => Promise<Response>): Promise<{ title: string | null; text: string } | null> {
  const res = await pacedGet(() => get(`https://api.twitterapi.io/twitter/article?tweet_id=${encodeURIComponent(o.postId)}`));
  const text = await res.text();
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(httpError("twitterapi.io article", res.status, text));
  let body: { status?: string; msg?: string; message?: string; article?: TwitterApiArticle | null };
  try { body = JSON.parse(text); } catch { throw new Error("twitterapi.io article reply was not valid JSON"); }
  if (body.status === "error") throw new Error(`twitterapi.io article error: ${body.message ?? body.msg ?? "unknown"}`);
  const a = body.article;
  if (!a) return null;
  const blocks = (a.contents ?? []).map((b) => (b.text ?? "").trim()).filter(Boolean);
  if (!blocks.length && !a.preview_text) return null;
  const parts = [a.title?.trim() && `Article: ${a.title.trim()}`, ...(blocks.length ? blocks : [a.preview_text!.trim()])].filter(Boolean);
  return { title: a.title?.trim() || null, text: parts.join("\n\n").slice(0, MAX_ARTICLE_CHARS) };
}

export interface XPostOptions {
  apiKey: string;
  postId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Reads one post from twitterapi.io (GET /twitter/tweets) and returns the stored transcript plus a title.
 * Posts have no timeline, so the single evidence item sits at second 0 and the window is [0, 0].
 * Throws with the actual failure (deleted, protected, bad key, rate limited) so the unit shows it.
 */
export async function extractXPost(o: XPostOptions): Promise<{ title: string; transcript: NonNullable<IngestedUnit["transcript"]> }> {
  const fetchUrl = (url: string) => (o.fetchImpl ?? fetch)(url, { headers: { "x-api-key": o.apiKey }, signal: AbortSignal.timeout(o.timeoutMs ?? 15_000) });
  const get = () => fetchUrl(`https://api.twitterapi.io/twitter/tweets?tweet_ids=${encodeURIComponent(o.postId)}`);
  const res = await pacedGet(get);
  const text = await res.text();
  if (!res.ok) throw new Error(httpError("twitterapi.io", res.status, text));
  let body: { status?: string; message?: string; msg?: string; tweets?: TwitterApiTweet[] };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("twitterapi.io reply was not valid JSON");
  }
  if (body.status === "error") throw new Error(`twitterapi.io error: ${body.message ?? body.msg ?? "unknown"}`);
  const post = body.tweets?.find((t) => t.id === o.postId);
  if (!post) throw new Error(UNAVAILABLE);

  const own = (post.text ?? "").trim();
  // An X Article's post is just a link; its body is what the bookmark is for.
  const article = onlyLinks(own) ? await readArticle(o, fetchUrl) : null;
  const quoted = post.quoted_tweet?.text?.trim();
  return shape({ own, article, quoted, quotedHandle: post.quoted_tweet?.author?.userName, author: post.author, createdAt: post.createdAt });
}

interface PostParts {
  own: string;
  article: { title: string | null; text: string } | null;
  quoted?: string;
  quotedHandle?: string;
  author?: { userName?: string; name?: string };
  createdAt?: string;
}

/** The stored title and transcript for one post, whichever route it was read from. */
function shape(p: PostParts): { title: string; transcript: NonNullable<IngestedUnit["transcript"]> } {
  let content = p.article ? [onlyLinks(p.own) ? "" : p.own, p.article.text].filter(Boolean).join("\n\n") : p.own;
  if (p.quoted) content += `\n\nQuoted post${p.quotedHandle ? ` by @${p.quotedHandle}` : ""}: ${p.quoted}`;
  if (!content) throw new Error("X post has no text");

  const handle = p.author?.userName;
  const byline = p.author ? `${p.author.name ?? handle ?? "unknown"}${handle ? ` (@${handle})` : ""}` : "unknown author";
  const created = p.createdAt && !Number.isNaN(Date.parse(p.createdAt)) ? new Date(p.createdAt).toISOString().slice(0, 10) : null;
  const item: EvidenceItem = { start_seconds: 0, end_seconds: 0, observed_spoken_content: content };
  return {
    title: `${handle ? `@${handle}` : "X post"}: ${(p.article?.title ?? (p.own || content)).replace(/\s+/g, " ").slice(0, 80)}`,
    transcript: { overview: `${p.article ? "X Article" : "X post"} by ${byline}${created ? ` on ${created}` : ""}.`, window: [0, 0], evidence_items: [item] },
  };
}

interface SyndicatedPost {
  text?: string;
  created_at?: string;
  user?: { screen_name?: string; name?: string };
  quoted_tweet?: { text?: string; user?: { screen_name?: string } };
  article?: { title?: string; preview_text?: string };
  tombstone?: unknown;
}

/** The token X's own embed widget derives from the post id; the endpoint only checks that it is well formed. */
const syndicationToken = (id: string) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

/**
 * Reads one post from X's public embed endpoint (cdn.syndication.twimg.com), which needs no key, login or paid plan.
 * An X Article comes back as its title and preview only; the full body needs twitterapi.io.
 */
export async function extractXPostPublic(o: Pick<XPostOptions, "postId" | "fetchImpl" | "timeoutMs">): Promise<{ title: string; transcript: NonNullable<IngestedUnit["transcript"]> }> {
  const res = await (o.fetchImpl ?? fetch)(`https://cdn.syndication.twimg.com/tweet-result?id=${o.postId}&token=${syndicationToken(o.postId)}`, { signal: AbortSignal.timeout(o.timeoutMs ?? 15_000) });
  const text = await res.text();
  if (res.status === 404) throw new Error(UNAVAILABLE);
  if (!res.ok) throw new Error(httpError("X embed", res.status, text));
  let post: SyndicatedPost;
  try { post = JSON.parse(text); } catch { throw new Error("X embed reply was not valid JSON"); }
  if (post.tombstone || (!post.text && !post.article)) throw new Error(UNAVAILABLE);
  const own = (post.text ?? "").trim();
  const a = post.article;
  const preview = [a?.title?.trim() && `Article: ${a.title.trim()}`, a?.preview_text?.trim()].filter(Boolean).join("\n\n");
  const article = a && preview ? { title: a.title?.trim() || null, text: preview } : null;
  const quoted = post.quoted_tweet?.text?.trim();
  return shape({ own, article, quoted, quotedHandle: post.quoted_tweet?.user?.screen_name, author: { userName: post.user?.screen_name, name: post.user?.name }, createdAt: post.created_at });
}
