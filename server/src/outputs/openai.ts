import { httpError } from "../httpError.js";
import { DEFAULT_DIGEST_MODEL, DEFAULT_MAX_OUTPUT_TOKENS } from "../ingest/digest/run.js";

export interface ChatJsonOptions {
  apiKey: string;
  /** OPENAI_MODEL; the digest default otherwise. */
  model?: string;
  system: string;
  user: string;
  /** Output cap, counting a reasoning model's hidden thinking tokens; defaults to the digest's cap. */
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

/** One JSON-mode chat completion. Throws with the actual HTTP or parse failure. */
export async function chatJson(o: ChatJsonOptions): Promise<unknown> {
  const cap = o.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const res = await (o.fetchImpl ?? fetch)("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
    body: JSON.stringify({
      model: o.model ?? DEFAULT_DIGEST_MODEL,
      max_completion_tokens: cap,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: o.system }, { role: "user", content: o.user }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(httpError("OpenAI", res.status, text));
  const data = JSON.parse(text);
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new Error(`OpenAI refused: ${String(choice.message.refusal).slice(0, 200)}`);
  // A reasoning model's hidden thinking counts against the cap, so a truncated reply says so instead of failing to parse.
  if (choice?.finish_reason === "length") {
    throw new Error(`OpenAI hit the ${cap}-token output cap before finishing (${data.usage?.completion_tokens_details?.reasoning_tokens ?? "?"} reasoning tokens)`);
  }
  const content: string | undefined = choice?.message?.content;
  if (!content) throw new Error(`OpenAI returned no content (finish_reason: ${choice?.finish_reason ?? "none"})`);
  return JSON.parse(content);
}
