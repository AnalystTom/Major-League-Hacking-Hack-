// Integration test: needs a database with db/migrations/001_shared_schema.sql applied.
// Run with TEST_DATABASE_URL=postgres://... npm test. Skipped otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PgStore } from "../src/store.ts";
import { ingestLink } from "../src/pipeline.ts";
import { validateDigest } from "../src/digest/validate.ts";

const url = process.env.TEST_DATABASE_URL;

test("PgStore writes match the shared schema", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  const pool = new pg.Pool({ connectionString: url });
  const store = new PgStore(pool);
  const ids: { unit: string[]; artifact: string[]; prompt?: string } = { unit: [], artifact: [] };
  try {
    const ok = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      source_url: "https://www.youtube.com/watch?v=VQy50fuxI34", content_accessed: true,
      evidence_items: [{ start_seconds: 5, end_seconds: 20, observed_spoken_content: "x" }] }) }] } }] }));
    const good = await ingestLink("https://www.youtube.com/watch?v=VQy50fuxI34&list=WL&index=4", { geminiKey: "k", store, fetchImpl: ok as typeof fetch });
    const bad = await ingestLink("https://example.com/nope", { geminiKey: "k", store });
    const unused = await ingestLink("https://www.youtube.com/watch?v=V-EDrhIhHzQ&t=306s", { geminiKey: "k", store, fetchImpl: (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      source_url: "https://www.youtube.com/watch?v=V-EDrhIhHzQ", content_accessed: true,
      evidence_items: [{ start_seconds: 310, end_seconds: 330, observed_spoken_content: "y" }] }) }] } }] }))) as typeof fetch });
    ids.unit.push(good.id, bad.id, unused.id);
    assert.equal(good.status, "ready");
    assert.equal(bad.status, "failed");

    const { rows } = await pool.query("select status, error, source_url, start_seconds, submitted_url from ingested_units where id = any($1)", [ids.unit]);
    assert.equal(rows.length, 3);
    const ready = await store.listReadyUnits();
    assert.ok(ready.some((u) => u.id === good.id && u.transcript?.evidence_items.length === 1));

    const prompt = await pool.query("insert into digestion_prompts (revision, prompt_text) values ((select coalesce(max(revision),0)+1 from digestion_prompts), 'test') returning id");
    ids.prompt = prompt.rows[0].id;
    const digest = validateDigest({
      artifacts: [{ name: "a", source_ids: [good.id], category: "c", processed_text: "t", selection_reason: "r",
        evidence: [{ source_id: good.id, start_seconds: 5, end_seconds: 20, passage: "p" }] }],
      exclusions: [{ unit_id: unused.id, reason: "unrelated" }],
    }, [good, unused]);
    const stored = await store.saveArtifacts(digest.artifacts, digest.exclusions, ids.prompt!);
    ids.artifact = stored.map((s) => s.id);
    assert.equal(stored[0].review_status, "pending");
    assert.equal(stored[0].version, 1);
    assert.equal(stored[0].sources[0].url, "https://www.youtube.com/watch?v=VQy50fuxI34");
    const a = await pool.query("select ingestion_status, review_status, source_ids, sources, source_url from artifacts where id = $1", [ids.artifact[0]]);
    assert.equal(a.rows[0].ingestion_status, "ready");
    assert.equal(a.rows[0].review_status, "pending");
    assert.deepEqual(a.rows[0].source_ids, [good.id]);
    assert.equal(a.rows[0].source_url, "https://www.youtube.com/watch?v=VQy50fuxI34");
    const ex = await pool.query("select reason from artifact_exclusions where digestion_prompt_id = $1", [ids.prompt]);
    assert.equal(ex.rows[0].reason, "unrelated");
  } finally {
    if (ids.prompt) await pool.query("delete from artifact_exclusions where digestion_prompt_id = $1", [ids.prompt]);
    if (ids.artifact.length) await pool.query("delete from artifacts where id = any($1)", [ids.artifact]);
    if (ids.prompt) await pool.query("delete from digestion_prompts where id = $1", [ids.prompt]);
    if (ids.unit.length) await pool.query("delete from ingested_units where id = any($1)", [ids.unit]);
    await pool.end();
  }
});
