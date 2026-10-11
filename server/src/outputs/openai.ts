import { httpError } from "../httpError.js";
import { DEFAULT_DIGEST_MODEL } from "../ingest/digest/run.js";

export interface ChatJsonOptions {
  apiKey: string;
  /** OPENAI_MODEL; the digest default otherwise. */
  model?: string;
  system: string;
  user: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

/** One JSON-mode chat completion. Throws with the actual HTTP or parse failure. */
export async function chatJson(o: ChatJsonOptions): Promise<unknown> {
  const res = await (o.fetchImpl ?? fetch)("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
    body: JSON.stringify({
      model: o.model ?? DEFAULT_DIGEST_MODEL,
      max_completion_tokens: o.maxTokens ?? 8000,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: o.system }, { role: "user", content: o.user }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(httpError("OpenAI", res.status, text));
  const content: string | undefined = JSON.parse(text).choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  return JSON.parse(content);
}
