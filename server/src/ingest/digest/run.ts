import { effortField } from "../../openaiEffort.js";
import { httpError } from "../../httpError.js";
import { openaiUsage, recordUsage } from "../../usage.js";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import { validateDigest } from "./validate.js";
import type { DigestOutput, IngestedUnit } from "../types.js";

export const DEFAULT_DIGEST_MODEL = "gpt-6-luna";
export const DEFAULT_MAX_OUTPUT_TOKENS = 20000;

export interface DigestOptions {
  apiKey: string;
  /** Override with OPENAI_MODEL; defaults to DEFAULT_DIGEST_MODEL. */
  model?: string;
  /** Output cap, including a reasoning model's hidden thinking tokens. Override with OPENAI_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
  /** Tries before giving up on a reply that fails validation; each retry tells the model what was wrong (default 2). */
  maxAttempts?: number;
  units: IngestedUnit[];
  request: string;
  fewShot?: unknown[];
  fetchImpl?: typeof fetch;
}

type Message = { role: "system" | "user" | "assistant"; content: string };

export async function runDigestion(o: DigestOptions): Promise<DigestOutput> {
  if (o.units.length === 0) return { artifacts: [], exclusions: [] };
  const cap = o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const attempts = Math.max(1, o.maxAttempts ?? 2);
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(o.units, o.request, o.fewShot) },
  ];

  let failure = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const content = await complete(o, messages, cap);
    try {
      return validateDigest(JSON.parse(content), o.units);
    } catch (e) {
      failure = (e as Error).message;
      // Malformed JSON or a citation of a unit that was not supplied: show the model its mistake and ask again.
      messages.push(
        { role: "assistant", content },
        { role: "user", content: `Your previous output was rejected: ${failure}. Return the complete corrected JSON in the same format, citing only the supplied unit refs.` },
      );
    }
  }
  throw new Error(attempts > 1 ? `${failure} (after ${attempts} attempts)` : failure);
}

/** One OpenAI call. Transport, refusal, truncation and empty-reply problems throw with their details and are not retried. */
async function complete(o: DigestOptions, messages: Message[], cap: number): Promise<string> {
  const res = await (o.fetchImpl ?? fetch)("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
    body: JSON.stringify({
      model: o.model ?? DEFAULT_DIGEST_MODEL,
      max_completion_tokens: cap,
      ...effortField(),
      response_format: { type: "json_object" },
      messages,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(httpError("Digestion", res.status, text));
  const data = JSON.parse(text);
  recordUsage({ step: "digest", provider: "openai", model: o.model ?? DEFAULT_DIGEST_MODEL, ...openaiUsage(data.usage), ref: `${o.units.length} unit(s)` });
  const choice = data.choices?.[0];
  const content: string | undefined = choice?.message?.content;
  const finish: string | undefined = choice?.finish_reason;
  const used = data.usage?.completion_tokens;
  const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens;
  const detail = `finish_reason: ${finish ?? "none"}; completion tokens ${used ?? "?"} of ${cap}${reasoning != null ? ` (${reasoning} reasoning)` : ""}`;
  if (choice?.message?.refusal) throw new Error(`Digestion was refused: ${String(choice.message.refusal).slice(0, 200)}`);
  if (finish === "length") {
    throw new Error(`Digestion hit the ${cap}-token output cap before finishing (${detail}); raise OPENAI_MAX_OUTPUT_TOKENS or digest fewer videos at once`);
  }
  if (!content) throw new Error(`Digestion returned no content (${detail})`);
  return content;
}
