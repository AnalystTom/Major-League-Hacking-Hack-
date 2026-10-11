// Hands new units to the processing service (Gemini extraction -> Digestion Prompt -> Opus script ->
// narration/music/render -> R2 upload). The service writes its progress back to TigerData itself.

/**
 * POSTs { unit_ids, project } to PROCESSOR_URL with the PROCESSOR_TOKEN bearer. Returns what actually happened:
 * "requested" (2xx), "unavailable" (error or non-2xx), or "not_configured". Never throws.
 */
export async function requestProcessing(env, unitIds, fetchImpl = fetch, project = null) {
  if (unitIds.length === 0) return "not_needed";
  if (!env.PROCESSOR_URL) return "not_configured";
  try {
    const res = await fetchImpl(env.PROCESSOR_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.PROCESSOR_TOKEN ? { authorization: `Bearer ${env.PROCESSOR_TOKEN}` } : {}),
      },
      // The brief the digest should be matched against: { id, version, name, goal, tools, agents }.
      body: JSON.stringify({ unit_ids: unitIds, project }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? "requested" : "unavailable";
  } catch {
    return "unavailable";
  }
}
