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
  const created = { users: [] as string[], units: [] as string[], projects: [] as string[], prompts: new Set<string>(), artifacts: [] as string[] };
  try {
    // What the web Worker leaves behind: a user, a project brief, pending units and user_imports rows.
    const user = (await pool.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`t-${randomUUID()}@example.com`])).rows[0].id;
    created.users.push(user);
    const facts = [{ kind: "tool", fact: "TypeScript", source: "onboarding" }, { kind: "agent", fact: "Codex", id: "codex", source: "onboarding" }];
    const proj = (await pool.query(`INSERT INTO project_contexts (version, name, goal, facts) VALUES (1, 'Pg project', 'ship', $1) RETURNING id`, [JSON.stringify(facts)])).rows[0].id;
    created.projects.push(proj);
    const mk = async (videoId: string, start: number | null) => {
      const r = await pool.query(`INSERT INTO ingested_units (submitted_url, source_url, start_seconds) VALUES ($1,$2,$3) RETURNING id`,
        [`https://www.youtube.com/watch?v=${videoId}&list=WL`, `https://www.youtube.com/watch?v=${videoId}`, start]);
      created.units.push(r.rows[0].id);
      await pool.query(`INSERT INTO user_imports (user_id, unit_id, project_context_id, project_context_version) VALUES ($1,$2,$3,1)`, [user, r.rows[0].id, proj]);
      return r.rows[0].id as string;
    };
    const a = await mk("VQy50fuxI34", null), b = await mk("V-EDrhIhHzQ", 306);

    // project comes from user_imports + project_contexts, in the web Worker's fact shape
    const project = await store.projectForUnit(a);
    assert.deepEqual(project, { id: proj, version: 1, name: "Pg project", goal: "ship", tools: ["TypeScript"], agents: ["codex"] });
    assert.deepEqual((await store.listPendingUnitIds(50)).filter((id) => created.units.includes(id)).sort(), [a, b].sort());

    // two concurrent requests: SKIP LOCKED claiming extracts once
    const { impl, calls } = mockFetch();
    const o = { geminiKey: "k", openaiKey: "o", store, fetchImpl: impl, retries: 0, pollMs: 5, waitTimeoutMs: 5000 };
    await Promise.all([processUnits([a, b], project, o), processUnits([a, b], project, o)]);
    assert.equal(calls.gemini, 2, "one Gemini call per unit despite two requests");
    const units = await store.getUnits([a, b]);
    assert.deepEqual(units.map((u) => u.status), ["ready", "ready"]);
    assert.equal(units[0].title, "Real Title");
    assert.deepEqual(units.find((u) => u.id === b)?.transcript?.window, [306, 606]);

    const arts = (await pool.query(`SELECT id, version, project_context_id, project_context_version, ingestion_status, digestion_prompt_id, source_ids
                                    FROM artifacts WHERE source_ids && $1::uuid[]`, [[a, b]])).rows;
    assert.equal(arts.length, 1, "digested once");
    assert.equal(arts[0].project_context_id, proj);
    assert.equal(arts[0].project_context_version, 1);
    created.artifacts.push(arts[0].id);
    created.prompts.add(arts[0].digestion_prompt_id);

    // nothing pending is left for the sweep, and a repeat request digests nothing
    assert.equal((await store.listPendingUnitIds(50)).filter((id) => created.units.includes(id)).length, 0);
    assert.equal((await sweepOnce(o)) >= 0, true);
    assert.equal((await processUnits([a, b], project, o)).digested, 0);

    // a failed digest is stored as a failed artifact with its error, and a new project version retries
    const failing = mockFetch({ digestStatus: () => 500 });
    const v2 = { ...project!, version: 2 };
    await pool.query(`INSERT INTO project_contexts (id, version, name, goal, facts) VALUES ($1, 2, 'Pg project', 'ship', '[]')`, [proj]);
    await processUnits([a], v2, { ...o, fetchImpl: failing.impl });
    const failed = (await pool.query(`SELECT id, ingestion_status, error FROM artifacts WHERE source_ids = $1::uuid[] AND project_context_version = 2`, [[a]])).rows[0];
    assert.equal(failed.ingestion_status, "failed");
    assert.match(failed.error, /500/);
    created.artifacts.push(failed.id);
    const retry = await processUnits([a], v2, o);
    assert.equal(retry.digested, 1, "a failed artifact does not block the retry");

    // migration 004: revisions share an id, ready content is frozen, status stays writable
    const ready = (await pool.query(`SELECT id FROM artifacts WHERE source_ids = $1::uuid[] AND project_context_version = 2 AND ingestion_status = 'ready'`, [[a]])).rows[0].id;
    created.artifacts.push(ready);
    await pool.query(`INSERT INTO artifacts (id, version, name, source_url, source_ids, processed_text, ingestion_status)
                      SELECT id, 2, name, source_url, source_ids, 'revised', 'ready' FROM artifacts WHERE id = $1 AND version = 1`, [ready]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM artifacts WHERE id = $1`, [ready])).rows[0].n, 2);
    await assert.rejects(pool.query(`UPDATE artifacts SET processed_text = 'edited' WHERE id = $1 AND version = 1`, [ready]), /immutable/);
    await pool.query(`UPDATE artifacts SET review_status = 'approved', error = NULL WHERE id = $1 AND version = 1`, [ready]);
  } finally {
    await pool.query(`DELETE FROM artifacts WHERE id = ANY($1) OR source_ids && $2::uuid[]`, [created.artifacts, created.units]);
    await pool.query(`DELETE FROM artifact_exclusions WHERE unit_id = ANY($1)`, [created.units]);
    await pool.query(`DELETE FROM user_imports WHERE unit_id = ANY($1)`, [created.units]);
    await pool.query(`DELETE FROM ingested_units WHERE id = ANY($1)`, [created.units]);
    await pool.query(`DELETE FROM project_contexts WHERE id = ANY($1)`, [created.projects]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [created.users]);
    if (created.prompts.size) await pool.query(`DELETE FROM digestion_prompts WHERE id = ANY($1)`, [[...created.prompts]]);
    await pool.end();
  }
});
