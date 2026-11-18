import { recordError } from "./activity.js";

export const STALE_CLAIM_MINUTES = 60;
export const HEARTBEAT_MINUTES = 5;
export const EXHAUSTED_CLAIM_ERROR = "stopped responding after the maximum attempts";

export async function whileHeld<T>(heartbeat: () => Promise<unknown>, work: () => Promise<T>, everyMs = HEARTBEAT_MINUTES * 60_000): Promise<T> {
  const timer = setInterval(() => { heartbeat().catch((e) => recordError("claim heartbeat failed", e)); }, everyMs);
  try { return await work(); } finally { clearInterval(timer); }
}
