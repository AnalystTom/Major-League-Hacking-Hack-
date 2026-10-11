import { SYSTEM_PROMPT, buildUserMessage, type ProjectContext } from "./prompt.ts";
import { validateDigest } from "./validate.ts";
import type { DigestOutput, IngestedUnit } from "../types.ts";

export const DIGEST_MODEL = "claude-opus-5-5";

export interface DigestOptions {
  apiKey: string;
  units: IngestedUnit[];
  request: string;
  context: ProjectContext;
  fewShot?: unknown[];
  fetchImpl?: typeof fetch;
}

export async function runDigestion(o: DigestOptions): Promise<DigestOutput> {
  if (o.units.length === 0) return { artifacts: [], exclusions: [] };
  const res = await (o.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": o.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: DIGEST_MODEL, max_tokens: 8000, temperature: 0, system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(o.units, o.request, o.context, o.fewShot) }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Digestion HTTP ${res.status}: ${text.slice(0, 300)}`);
  const content: string = JSON.parse(text).content?.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("") ?? "";
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  return validateDigest(JSON.parse(json), o.units);
}
