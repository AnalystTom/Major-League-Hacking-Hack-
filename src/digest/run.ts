import { SYSTEM_PROMPT, buildUserMessage, type ProjectContext } from "./prompt.ts";
import { validateDigest } from "./validate.ts";
import type { DigestOutput, IngestedUnit } from "../types.ts";

export const DEFAULT_DIGEST_MODEL = "gpt-5";

export interface DigestOptions {
  apiKey: string;
  /** Override with OPENAI_MODEL; defaults to DEFAULT_DIGEST_MODEL. */
  model?: string;
  units: IngestedUnit[];
  request: string;
  context: ProjectContext;
  fewShot?: unknown[];
  fetchImpl?: typeof fetch;
}

export async function runDigestion(o: DigestOptions): Promise<DigestOutput> {
  if (o.units.length === 0) return { artifacts: [], exclusions: [] };
  const res = await (o.fetchImpl ?? fetch)("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
    body: JSON.stringify({
      model: o.model ?? DEFAULT_DIGEST_MODEL,
      max_completion_tokens: 8000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(o.units, o.request, o.context, o.fewShot) },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Digestion HTTP ${res.status}: ${text.slice(0, 300)}`);
  const content: string | undefined = JSON.parse(text).choices?.[0]?.message?.content;
  if (!content) throw new Error("Digestion returned no content");
  return validateDigest(JSON.parse(content), o.units);
}
