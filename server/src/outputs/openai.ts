import { httpError } from "../httpError.js";
import { effortField } from "../openaiEffort.js";
import { openaiUsage, recordUsage, type Usage } from "../usage.js";
import { DEFAULT_DIGEST_MODEL, DEFAULT_MAX_OUTPUT_TOKENS } from "../ingest/digest/run.js";
import type { OpenAIOptions } from "./types.js";

/** model is OPENAI_MODEL, else the digest default. The output cap is the digest's, counting hidden reasoning. */
export interface ChatJsonOptions extends OpenAIOptions {
  /** Which output this call is for, recorded with its token usage. */
  step: Extract<Usage["step"], "skill" | "script" | "handoff" | "judge">;
  /** The artifact it's for. */
  ref?: string;
  system: string;
  user: string;
  images?: string[];
}

/** One JSON-mode chat completion. Throws with the actual HTTP or parse failure. */
export async function chatJson(o: ChatJsonOptions): Promise<unknown> {
  // OPENAI_MAX_OUTPUT_TOKENS, like the digest: a high reasoning effort needs room for its hidden reasoning tokens.
  const cap = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) > 0 ? Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) : DEFAULT_MAX_OUTPUT_TOKENS;
  const res = await (o.fetchImpl ?? fetch)("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
    body: JSON.stringify({
      model: o.model ?? DEFAULT_DIGEST_MODEL,
      max_completion_tokens: cap,
      ...effortField(),
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: o.system }, { role: "user", content: o.images?.length ? [{ type: "text", text: o.user }, ...o.images.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } }))] : o.user }],
    }),
    // xhigh reasoning over a five-skill brief has taken over three minutes; a stuck call still ends inside STALE_BRIEF_MINUTES.
    signal: AbortSignal.timeout(600_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(httpError("OpenAI", res.status, text));
  const data = JSON.parse(text);
  recordUsage({ step: o.step, provider: "openai", model: o.model ?? DEFAULT_DIGEST_MODEL, ...openaiUsage(data.usage), ref: o.ref ?? null });
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
