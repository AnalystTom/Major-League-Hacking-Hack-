// Hands new units to the processing service (Gemini extraction -> Digestion Prompt -> Opus script ->
// narration/music/render -> R2 upload). The service writes its progress back to D1 itself.

// The processor accepts at most 10 unit ids per request, so larger imports go out in batches.
export const PROCESSOR_BATCH = 10;

// A Worker can't fetch() another Worker on the same workers.dev zone (Cloudflare error 1042), so in production the
// call goes through the PROCESSOR service binding. The URL's path still picks the route; its host is ignored.
export const processorFetch = (env, fetchImpl) => (env.PROCESSOR ? (url, init) => env.PROCESSOR.fetch(url, init) : fetchImpl);

/**
 * POSTs { unit_ids } to PROCESSOR_URL with the PROCESSOR_TOKEN bearer. Returns what actually happened:
 * "requested" (every batch 2xx), "unavailable" (any error or non-2xx; the sweep picks up what was missed),
 * or "not_configured". Never throws.
 */
export async function requestProcessing(env, unitIds, fetchImpl = fetch) {
  if (unitIds.length === 0) return "not_needed";
  if (!env.PROCESSOR_URL) return "not_configured";
  const batches = [];
  for (let i = 0; i < unitIds.length; i += PROCESSOR_BATCH) batches.push(unitIds.slice(i, i + PROCESSOR_BATCH));
  const send = processorFetch(env, fetchImpl);
  const results = await Promise.all(batches.map(async (batch) => {
    try {
      const res = await send(env.PROCESSOR_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(env.PROCESSOR_TOKEN ? { authorization: `Bearer ${env.PROCESSOR_TOKEN}` } : {}),
        },
        body: JSON.stringify({ unit_ids: batch }),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }));
  return results.every(Boolean) ? "requested" : "unavailable";
}
