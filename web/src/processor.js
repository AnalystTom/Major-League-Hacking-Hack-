import { logFailure } from "./log.js";

export const PROCESSOR_BATCH = 10;
export const processorFetch = (env, fetchImpl) => (env.PROCESSOR ? (url, init) => env.PROCESSOR.fetch(url, init) : fetchImpl);

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
      if (!res.ok) logFailure("processor request failed", `HTTP ${res.status}`);
      return res.ok;
    } catch (error) {
      logFailure("processor request failed", error);
      return false;
    }
  }));
  return results.every(Boolean) ? "requested" : "unavailable";
}

export async function requestVideoProcessing(env, fetchImpl = fetch) {
  if (!env.PROCESSOR_URL) return "not_configured";
  try {
    const url = new URL(env.PROCESSOR_URL);
    url.pathname = "/health";
    url.search = "";
    const response = await processorFetch(env, fetchImpl)(url.toString(), {
      headers: env.PROCESSOR_TOKEN ? { authorization: `Bearer ${env.PROCESSOR_TOKEN}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) return "requested";
    logFailure("processor video wake failed", `HTTP ${response.status}`);
    return "unavailable";
  } catch (error) {
    logFailure("processor video wake failed", error);
    return "unavailable";
  }
}
