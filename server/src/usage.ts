// Provider token usage, one record per successful call, so a run's provider cost can be added up. Library code
// records; the entry point decides where records go (src/index.ts logs them as `[usage] {json}` lines and, with D1, saves them to usage_events).

import type { Database } from "./db.js";

export interface Usage {
  step: "extract" | "digest" | "skill" | "script" | "tts" | "handoff" | "judge";
  provider: "gemini" | "openai" | "workers-ai";
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  /** Hidden thinking tokens, already included in output_tokens for billing. */
  reasoning_tokens: number | null;
  /** What the call was for: a video URL, a unit count, an artifact id. */
  ref: string | null;
}

let sink: (u: Usage) => void = () => {};

/** Stores one usage record in D1's usage_events, so cost per processed item can be measured from production. */
export const saveUsage = (db: Database, u: Usage) => db.query(
  "INSERT INTO usage_events(step,provider,model,input_tokens,output_tokens,reasoning_tokens,ref) VALUES(?1,?2,?3,?4,?5,?6,?7)",
  [u.step, u.provider, u.model, u.input_tokens, u.output_tokens, u.reasoning_tokens, u.ref]);

export function setUsageSink(fn: (u: Usage) => void) { sink = fn; }

export function recordUsage(u: Usage) {
  try { sink(u); } catch {}
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Chat Completions `usage`. */
export const openaiUsage = (usage: any) => ({
  input_tokens: num(usage?.prompt_tokens),
  output_tokens: num(usage?.completion_tokens),
  reasoning_tokens: num(usage?.completion_tokens_details?.reasoning_tokens),
});

/** generateContent `usageMetadata`, or an Interactions reply's `usage`. Gemini bills thinking as output. */
export const geminiUsage = (body: any) => {
  const m = body?.usageMetadata, u = body?.usage;
  const thoughts = num(m?.thoughtsTokenCount);
  const candidates = num(m?.candidatesTokenCount);
  return {
    input_tokens: num(m?.promptTokenCount) ?? num(u?.input_tokens) ?? num(u?.total_input_tokens),
    output_tokens: candidates !== null || thoughts !== null ? (candidates ?? 0) + (thoughts ?? 0) : num(u?.output_tokens) ?? num(u?.total_output_tokens),
    reasoning_tokens: thoughts ?? num(u?.reasoning_tokens) ?? num(u?.total_reasoning_tokens),
  };
};
