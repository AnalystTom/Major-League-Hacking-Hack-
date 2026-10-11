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
