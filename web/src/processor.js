export const PROCESSOR_BATCH = 10;
const BOUND_PROCESSOR_URL = "https://processor/api/ingest/process";
const PROCESSOR_TIMEOUT_MS = 8000;

function connectProcessor(env, fetchImpl = fetch) {
  const processUrl = env.PROCESSOR ? BOUND_PROCESSOR_URL : env.PROCESSOR_URL;
  if (!processUrl) return null;
  const send = env.PROCESSOR ? (url, init) => env.PROCESSOR.fetch(url, init) : fetchImpl;
  const authorization = env.PROCESSOR_TOKEN ? { authorization: `Bearer ${env.PROCESSOR_TOKEN}` } : {};
  return {
    processUrl,
    get: (url) => send(url, { headers: authorization, signal: AbortSignal.timeout(PROCESSOR_TIMEOUT_MS) }),
    post: (url, body) => send(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...authorization },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROCESSOR_TIMEOUT_MS),
    }),
  };
}

const outcome = async (call) => {
  try {
    return (await call()).ok ? "requested" : "unavailable";
  } catch {
    return "unavailable";
  }
};

export async function requestProcessing(env, unitIds, fetchImpl = fetch) {
  if (unitIds.length === 0) return "not_needed";
  const processor = connectProcessor(env, fetchImpl);
  if (!processor) return "not_configured";
  const batches = [];
  for (let i = 0; i < unitIds.length; i += PROCESSOR_BATCH) batches.push(unitIds.slice(i, i + PROCESSOR_BATCH));
  const results = await Promise.all(batches.map((batch) => outcome(() => processor.post(processor.processUrl, { unit_ids: batch }))));
  return results.every((result) => result === "requested") ? "requested" : "unavailable";
}

export async function requestVideoProcessing(env, fetchImpl = fetch) {
  const processor = connectProcessor(env, fetchImpl);
  if (!processor) return "not_configured";
  return outcome(() => processor.get(new URL("/health", processor.processUrl).toString()));
}

export async function requestHandoff(env, briefId, fetchImpl = fetch) {
  const processor = connectProcessor(env, fetchImpl);
  if (!processor) return "not_configured";
  return outcome(() => processor.post(new URL("handoff", processor.processUrl).toString(), { brief_id: briefId }));
}
