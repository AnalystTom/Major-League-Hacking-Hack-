// The processing_starts ledger the limits count (db/migrations/007, 010), shared by the ingest store (extractions,
// digests), the outputs store (retried skills and shorts) and the handoff store (agent briefs). Callers hold one transaction for the lock, the count
// and the write, so concurrent workers can't both take the last slot.

import type pg from "pg";

const UTC_DAY = `(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;
const UTC_MONTH = `(date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

export type StartKind = "extract" | "digest" | "retry" | "handoff";

/** Serialises everyone who counts and takes slots, until the transaction ends. */
export async function lockLimits(client: pg.PoolClient) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('resurface:processing-limits'))`);
}

/** Charged starts today and this month (UTC). */
export async function usedSlots(client: pg.PoolClient) {
  const { rows: [c] } = await client.query(
    `SELECT count(*) FILTER (WHERE created_at >= ${UTC_DAY})::int AS today, count(*)::int AS month
     FROM processing_starts WHERE charged AND created_at >= ${UTC_MONTH}`);
  return { today: c.today as number, month: c.month as number };
}

export async function recordStarts(client: pg.PoolClient, unitIds: string[], kind: StartKind, charged: boolean) {
  if (unitIds.length === 0) return;
  await client.query(`INSERT INTO processing_starts (unit_id, kind, charged) SELECT unnest($1::uuid[]), $2, $3`, [unitIds, kind, charged]);
}
