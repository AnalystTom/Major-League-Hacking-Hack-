// Every paid start is inserted conditionally within the same D1 batch as its claim.
// SQLite serializes each batch, so concurrent callers cannot spend the same last slot.
import type { Database } from '../db.js';
import type { Limits } from './limits.js';
export type StartKind = 'extract' | 'digest' | 'retry' | 'handoff';
export const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export const USED_DAY = "(SELECT count(*) FROM processing_starts WHERE charged = 1 AND created_at >= strftime('%Y-%m-%dT00:00:00.000Z','now'))";
export const USED_MONTH = "(SELECT count(*) FROM processing_starts WHERE charged = 1 AND created_at >= strftime('%Y-%m-01T00:00:00.000Z','now'))";
export const available = (daily = '?1', monthly = '?2') => `(${USED_DAY} < ${daily} AND ${USED_MONTH} < ${monthly})`;
export const deferredUntil = (monthly = '?2') => `CASE WHEN ${USED_MONTH} >= ${monthly}
  THEN strftime('%Y-%m-01T00:00:00.000Z','now','start of month','+1 month')
  ELSE strftime('%Y-%m-%dT00:00:00.000Z','now','start of day','+1 day') END`;
export const limitParams = (l: Limits) => [Number.isFinite(l.daily) ? l.daily : Number.MAX_SAFE_INTEGER,
  Number.isFinite(l.monthly) ? l.monthly : Number.MAX_SAFE_INTEGER];
export async function usedSlots(db: Database) {
  const { rows: [r] } = await db.query(`SELECT ${USED_DAY} AS today, ${USED_MONTH} AS month`);
  return { today: Number(r.today), month: Number(r.month) };
}
