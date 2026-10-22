// OPENAI_REASONING_EFFORT: how hard a reasoning model thinks on every OpenAI call (digest, skills, scripts, handoffs).
// Unset sends nothing, so the model's own default applies. Hidden reasoning counts against the output cap.

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function reasoningEffort(value = process.env.OPENAI_REASONING_EFFORT): ReasoningEffort | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const v = value.trim() as ReasoningEffort;
  if (!REASONING_EFFORTS.includes(v)) throw new Error(`OPENAI_REASONING_EFFORT must be one of ${REASONING_EFFORTS.join(", ")} (got "${value}")`);
  return v;
}

/** The request field, only when an effort is configured. */
export const effortField = (effort?: ReasoningEffort) => { const e = effort ?? reasoningEffort(); return e ? { reasoning_effort: e } : {}; };
