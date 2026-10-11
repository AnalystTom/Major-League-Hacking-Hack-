// How much work this processor has in hand, reported by GET /health, so a host that sleeps idle containers
// can keep this one awake while an import is still being processed or a skill or short is running or queued.

let busy = 0;

export const busyCount = () => busy;

export async function tracked<T>(work: () => Promise<T>): Promise<T> {
  busy++;
  try {
    return await work();
  } finally {
    busy--;
  }
}

// The most recent processing failure, for GET /health: container logs aren't readable from outside, and /health is
// already behind the processor's bearer token. Anything that looks like credentials is removed before it's kept.
let lastError: { at: string; message: string } | null = null;

export const redact = (message: string) =>
  message
    .replace(/(\w+:\/\/)[^\s/@]+@/g, "$1<redacted>@")
    .replace(/(password|passwd|pwd|token|secret|api[_-]?key)(\s*[=:]\s*)\S+/gi, "$1$2<redacted>")
    .slice(0, 500);

export function recordError(where: string, e: unknown) {
  lastError = { at: new Date().toISOString(), message: redact(`${where}: ${e instanceof Error ? e.message : String(e)}`) };
}

export const lastErrorSeen = () => lastError;
