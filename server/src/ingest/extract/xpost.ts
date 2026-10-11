import type { EvidenceItem, IngestedUnit } from "../types.js";

export const X_POST_METHOD = "x-api:v2/tweets";
const FIELDS = "tweet.fields=created_at,note_tweet,article&expansions=author_id&user.fields=name,username";

interface XLookup {
  data?: { id: string; text: string; created_at?: string; note_tweet?: { text?: string }; author_id?: string };
  includes?: { users?: { id: string; name: string; username: string }[] };
  errors?: { title?: string; detail?: string }[];
}

export interface XPostOptions {
  bearerToken: string;
  postId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Reads one post from the X API v2 and returns the stored transcript plus a title.
 * Posts have no timeline, so the single evidence item sits at second 0 and the window is [0, 0].
 * Throws with the actual failure (deleted, protected, rate limited, bad token) so the unit shows it.
 */
export async function extractXPost(o: XPostOptions): Promise<{ title: string; transcript: NonNullable<IngestedUnit["transcript"]> }> {
  const res = await (o.fetchImpl ?? fetch)(`https://api.x.com/2/tweets/${o.postId}?${FIELDS}`, {
    headers: { authorization: `Bearer ${o.bearerToken}` },
    signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`X API HTTP ${res.status}: ${text.slice(0, 300)}`);
  let body: XLookup;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("X API reply was not valid JSON");
  }
  if (!body.data) {
    const why = body.errors?.map((e) => e.detail ?? e.title).filter(Boolean).join("; ");
    throw new Error(`X post unavailable${why ? `: ${why}` : ""}`);
  }
  const post = body.data;
  const content = (post.note_tweet?.text ?? post.text ?? "").trim();
  if (!content) throw new Error("X post has no text");
  const author = body.includes?.users?.find((u) => u.id === post.author_id);
  const byline = author ? `${author.name} (@${author.username})` : "unknown author";
  const item: EvidenceItem = { start_seconds: 0, end_seconds: 0, observed_spoken_content: content };
  return {
    title: `${author ? `@${author.username}` : "X post"}: ${content.replace(/\s+/g, " ").slice(0, 80)}`,
    transcript: { overview: `X post by ${byline}${post.created_at ? ` on ${post.created_at.slice(0, 10)}` : ""}.`, window: [0, 0], evidence_items: [item] },
  };
}
