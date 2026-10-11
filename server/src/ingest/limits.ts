// A hard cap on provider spend: how many new units may start per UTC day and per UTC month, across all users.
// The processor applies it when it claims units, so imports, sweeps, retries and every source type count.

export interface Limits { daily: number; monthly: number }

/** About $5 a month of provider spend at ~$0.12 a short (5-minute window), with room for a demo-day burst. */
export const DEFAULT_LIMITS: Limits = { daily: 10, monthly: 40 };
export const UNLIMITED: Limits = { daily: Infinity, monthly: Infinity };

function parse(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number of units, 0 or more (got "${value}")`);
  return n;
}

/** DAILY_VIDEO_LIMIT and MONTHLY_VIDEO_LIMIT; 0 pauses processing. Unset means the defaults. */
export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): Limits {
  return {
    daily: parse("DAILY_VIDEO_LIMIT", env.DAILY_VIDEO_LIMIT, DEFAULT_LIMITS.daily),
    monthly: parse("MONTHLY_VIDEO_LIMIT", env.MONTHLY_VIDEO_LIMIT, DEFAULT_LIMITS.monthly),
  };
}

export const startOfNextUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
export const startOfNextUtcMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

/** How many more units may start, given how many started today and this month. */
export const remaining = (l: Limits, used: { today: number; month: number }) =>
  Math.max(0, Math.min(l.daily - used.today, l.monthly - used.month));

/** When units held back now can start: next month if the monthly limit is the one that's used up, else tomorrow. */
export const resumesAt = (l: Limits, used: { today: number; month: number }, now: Date) =>
  used.month >= l.monthly ? startOfNextUtcMonth(now) : startOfNextUtcDay(now);
