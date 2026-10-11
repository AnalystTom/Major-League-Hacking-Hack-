// Integration test: needs a database with db/migrations 001-004 applied (002 for user_imports, 004 for revisions).
// Run with TEST_DATABASE_URL=postgres://... npm test. Skipped otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgStore } from "../../src/ingest/store.js";
import { processUnits, sweepOnce } from "../../src/ingest/processor.js";
import { mockFetch } from "./helpers.js";

const url = process.env.TEST_DATABASE_URL;

test("processor against the shared schema", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  const pool = new pg.Pool({ connectionString: url });
  const store = new PgStore(pool);
  const created = { users: [] as string[], units: [] as string[], prompts: new Set<string>() };
  try {
    // What the web Worker leaves behind: a user, pending units and user_imports rows (no project).
    const user = (await pool.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`t-${randomUUID()}@example.com`])).rows[0].id;
    created.users.push(user);
    const mk = async (videoId: string, start: number | null) => {
      const r = await pool.query(`INSERT INTO ingested_units (submitted_url, source_url, start_seconds) VALUES ($1,$2,$3) RETURNING id`,
        [`https://www.youtube.com/watch?v=${videoId}&list=WL`, `https://www.youtube.com/watch?v=${videoId}`, start]);
      created.units.push(r.rows[0].id);
      await pool.query(`INSERT INTO user_imports (user_id, unit_id) VALUES ($1,$2)`, [user, r.rows[0].id]);
      return r.rows[0].id as string;
    };
    const a = await mk("VQy50fuxI34", null), b = await mk("V-EDrhIhHzQ", 306);
    assert.deepEqual((await store.listPendingUnitIds(50)).filter((id) => created.units.includes(id)).sort(), [a, b].sort());

    // two concurrent requests: SKIP LOCKED claiming extracts once
    const { impl, calls } = mockFetch();
    const o = { geminiKey: "k", openaiKey: "o", store, fetchImpl: impl, retries: 0, pollMs: 5, waitTimeoutMs: 5000 };
    await Promise.all([processUnits([a, b], o), processUnits([a, b], o)]);
    assert.equal(calls.gemini, 2, "one Gemini call per unit despite two requests");
    const units = await store.getUnits([a, b]);
    assert.deepEqual(units.map((u) => u.status), ["ready", "ready"]);
    assert.equal(units[0].title, "Real Title");
    assert.deepEqual(units.find((u) => u.id === b)?.transcript?.window, [306, 3906]);

    const arts = (await pool.query(`SELECT id, project_context_id, project_context_version, digestion_prompt_id
                                    FROM artifacts WHERE source_ids && $1::uuid[]`, [[a, b]])).rows;
    assert.equal(arts.length, 1, "digested once");
    assert.equal(arts[0].project_context_id, null);
    assert.equal(arts[0].project_context_version, null);
    created.prompts.add(arts[0].digestion_prompt_id);

    // nothing pending is left for the sweep, and a repeat request digests nothing
    assert.equal((await store.listPendingUnitIds(50)).filter((id) => created.units.includes(id)).length, 0);
    assert.equal((await sweepOnce(o)) >= 0, true);
    assert.equal((await processUnits([a, b], o)).digested, 0);

    // an excluded unit is never sent to the model again
    await pool.query(`DELETE FROM artifacts WHERE source_ids && $1::uuid[]`, [[a, b]]);
    await pool.query(`INSERT INTO artifact_exclusions (unit_id, digestion_prompt_id, reason) VALUES ($1, $2, 'Off topic.')`, [a, arts[0].digestion_prompt_id]);
    assert.deepEqual(await store.unitsNeedingDigest([a, b]), [b]);

    // a failed digest is stored as a failed artifact with its error, and the next request retries it
    await processUnits([b], { ...o, fetchImpl: mockFetch({ digestStatus: () => 500 }).impl });
    const failed = (await pool.query(`SELECT ingestion_status, error FROM artifacts WHERE source_ids = $1::uuid[]`, [[b]])).rows[0];
    assert.equal(failed.ingestion_status, "failed");
    assert.match(failed.error, /500/);
    assert.equal((await processUnits([b], o)).digested, 1, "a failed artifact does not block the retry");

    // migration 004: revisions share an id, ready content is frozen, status stays writable
    const ready = (await pool.query(`SELECT id FROM artifacts WHERE source_ids = $1::uuid[] AND ingestion_status = 'ready'`, [[b]])).rows[0].id;
    await pool.query(`INSERT INTO artifacts (id, version, name, source_url, source_ids, processed_text, ingestion_status)
                      SELECT id, 2, name, source_url, source_ids, 'revised', 'ready' FROM artifacts WHERE id = $1 AND version = 1`, [ready]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM artifacts WHERE id = $1`, [ready])).rows[0].n, 2);
    await assert.rejects(pool.query(`UPDATE artifacts SET processed_text = 'edited' WHERE id = $1 AND version = 1`, [ready]), /immutable/);
    await pool.query(`UPDATE artifacts SET review_status = 'approved', error = NULL WHERE id = $1 AND version = 1`, [ready]);
  } finally {
    await pool.query(`DELETE FROM artifacts WHERE source_ids && $1::uuid[]`, [created.units]);
    await pool.query(`DELETE FROM artifact_exclusions WHERE unit_id = ANY($1)`, [created.units]);
    await pool.query(`DELETE FROM user_imports WHERE unit_id = ANY($1)`, [created.units]);
    await pool.query(`DELETE FROM ingested_units WHERE id = ANY($1)`, [created.units]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [created.users]);
    if (created.prompts.size) await pool.query(`DELETE FROM digestion_prompts WHERE id = ANY($1)`, [[...created.prompts]]);
    await pool.end();
  }
});

test("the processing limits hold across concurrent claims and mark the rest deferred", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  const pool = new pg.Pool({ connectionString: url });
  const store = new PgStore(pool);
  const ids: string[] = [];
  try {
    for (const v of ["VQy50fuxI34", "V-EDrhIhHzQ", "dQw4w9WgXcQ", "aaaaaaaaaaa"]) {
      ids.push((await pool.query(`INSERT INTO ingested_units (submitted_url, source_url) VALUES ($1, $1) RETURNING id`, [`https://www.youtube.com/watch?v=${v}`])).rows[0].id);
    }
    // Whatever this database already claimed today counts too, so allow exactly one more.
    const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM processing_starts WHERE charged AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
    const limits = { daily: c.n + 1, monthly: 100_000 };
    const [x, y] = await Promise.all([store.claimWithinLimits(ids.slice(0, 2), limits), store.claimWithinLimits(ids.slice(2), limits)]);
    assert.equal(x.claimed.length + y.claimed.length, 1, "one slot, one claim");
    const deferred = [...x.deferred, ...y.deferred];
    assert.equal(deferred.length, 3);
    const rows = (await pool.query(`SELECT id, status, deferred_until FROM ingested_units WHERE id = ANY($1::uuid[])`, [ids])).rows;
    assert.equal(rows.filter((r) => r.status === "running").length, 1);
    for (const r of rows.filter((r) => r.status === "pending")) assert.ok(r.deferred_until > new Date());
    const again = await store.claimWithinLimits(deferred, { daily: c.n + 4, monthly: 100_000 });
    assert.equal(again.claimed.length, 3);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM processing_starts WHERE unit_id = ANY($1::uuid[]) AND kind = 'extract' AND charged`, [ids])).rows[0].n, 4, "each claim is charged once");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ingested_units WHERE id = ANY($1::uuid[]) AND deferred_until IS NOT NULL`, [ids])).rows[0].n, 0, "claiming clears the deferral");

    // The digest each extraction paid for is free; digesting one again takes a slot, and with no room it waits.
    await pool.query(`UPDATE ingested_units SET status = 'ready', transcript = '{}' WHERE id = ANY($1::uuid[])`, [ids]);
    const first = await store.claimWithinLimits([], { daily: 0, monthly: 0 });
    assert.deepEqual(first.claimed, []);
    const free = await store.reserveDigests(ids, { daily: 0, monthly: 0 });
    assert.deepEqual(free.allowed, ids, "first digests are covered even with no room left");
    const repeat = await store.reserveDigests(ids.slice(0, 2), { daily: c.n + 5, monthly: 100_000 });
    assert.deepEqual(repeat.allowed, ids.slice(0, 1));
    assert.deepEqual(repeat.deferred, ids.slice(1, 2));
    assert.ok((await pool.query(`SELECT deferred_until FROM ingested_units WHERE id = $1`, [ids[1]])).rows[0].deferred_until > new Date());
  } finally {
    await pool.query(`DELETE FROM ingested_units WHERE id = ANY($1::uuid[])`, [ids]);
    await pool.end();
  }
});
