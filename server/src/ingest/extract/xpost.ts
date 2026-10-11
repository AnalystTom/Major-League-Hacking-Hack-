import { httpError } from "../../httpError.js";
import type { EvidenceItem, IngestedUnit } from "../types.js";

export const X_POST_METHOD = "twitterapi.io:tweets";

interface TwitterApiTweet {
  id: string;
  text?: string;
  createdAt?: string;
  author?: { userName?: string; name?: string; unavailable?: boolean; unavailableReason?: string };
  quoted_tweet?: { text?: string; author?: { userName?: string } } | null;
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
  const res = await (o.fetchImpl ?? fetch)(`https://api.twitterapi.io/twitter/tweets?tweet_ids=${encodeURIComponent(o.postId)}`, {
    headers: { "x-api-key": o.apiKey },
    signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
  });
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
  if (!post) throw new Error("X post unavailable: not found, deleted or protected");

  const own = (post.text ?? "").trim();
  let content = own;
  const quoted = post.quoted_tweet?.text?.trim();
  if (quoted) content += `\n\nQuoted post${post.quoted_tweet?.author?.userName ? ` by @${post.quoted_tweet.author.userName}` : ""}: ${quoted}`;
  if (!content) throw new Error("X post has no text");

  const handle = post.author?.userName;
  const byline = post.author ? `${post.author.name ?? handle ?? "unknown"}${handle ? ` (@${handle})` : ""}` : "unknown author";
  const created = post.createdAt && !Number.isNaN(Date.parse(post.createdAt)) ? new Date(post.createdAt).toISOString().slice(0, 10) : null;
  const item: EvidenceItem = { start_seconds: 0, end_seconds: 0, observed_spoken_content: content };
  return {
    title: `${handle ? `@${handle}` : "X post"}: ${(own || content).replace(/\s+/g, " ").slice(0, 80)}`,
    transcript: { overview: `X post by ${byline}${created ? ` on ${created}` : ""}.`, window: [0, 0], evidence_items: [item] },
  };
}
