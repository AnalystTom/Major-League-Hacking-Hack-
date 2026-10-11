// Integration test: needs db/migrations 001-005 applied. Run with TEST_DATABASE_URL=postgres://... npm test.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgOutputStore } from "../../src/outputs/store.js";
import { PgStore } from "../../src/ingest/store.js";

const url = process.env.TEST_DATABASE_URL;

test("outputs, stale claims and digest retries against the shared schema", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  const pool = new pg.Pool({ connectionString: url });
  const outputs = new PgOutputStore(pool);
  const store = new PgStore(pool);
  const made = { user: "", units: [] as string[], prompt: "", artifacts: [] as string[] };
  try {
    made.user = (await pool.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`o-${randomUUID()}@example.com`])).rows[0].id;
    const unit = async (status: string, extra = "") => {
      const id = (await pool.query(
        `INSERT INTO ingested_units (submitted_url, source_url, status, transcript${extra ? ", claimed_at" : ""})
         VALUES ('https://youtu.be/VQy50fuxI34', 'https://www.youtube.com/watch?v=VQy50fuxI34', $1, '{"window":[0,300]}'${extra ? `, ${extra}` : ""}) RETURNING id`,
        [status])).rows[0].id as string;
      made.units.push(id);
      await pool.query(`INSERT INTO user_imports (user_id, unit_id) VALUES ($1, $2)`, [made.user, id]);
      return id;
    };
    made.prompt = (await pool.query(`INSERT INTO digestion_prompts (revision, prompt_text) VALUES ((SELECT coalesce(max(revision),0)+1 FROM digestion_prompts), $1) RETURNING id`, [`t-${randomUUID()}`])).rows[0].id;

    // A unit its processor abandoned mid-extraction is claimable again; a fresh claim is not.
    const stale = await unit("running", "now() - interval '1 hour'");
    const fresh = await unit("running", "now()");
    const listed = await store.listPendingUnitIds(500);
    assert.ok(listed.includes(stale) && !listed.includes(fresh));
    const claimed = await store.claimPendingUnits([stale, fresh]);
    assert.deepEqual(claimed.map((u) => u.id), [stale]);

    // A ready unit with no digest is retried until it has failed MAX_DIGEST_ATTEMPTS times.
    const ready = await unit("ready");
    assert.ok((await store.listUnitsNeedingDigest(500)).includes(ready));
    for (let i = 0; i < 3; i++) await store.saveFailedArtifacts([ready], "boom", made.prompt);
    assert.ok(!(await store.listUnitsNeedingDigest(500)).includes(ready));

    // A ready artifact gets exactly one skill and one video row; both settle with their content.
    const a = (await pool.query(
      `INSERT INTO artifacts (name, source_url, source_ids, sources, processed_text, category, evidence, digestion_prompt_id, ingestion_status)
       VALUES ('Check first', 'https://www.youtube.com/watch?v=VQy50fuxI34', $1, $2, 'text', 'Evals', '[]', $3, 'ready') RETURNING id, version`,
      [[ready], JSON.stringify([{ url: "https://www.youtube.com/watch?v=VQy50fuxI34", title: "Evals" }]), made.prompt])).rows[0];
    made.artifacts.push(a.id);
    const needing = await outputs.artifactsNeeding("skill", 500);
    const art = needing.find((x) => x.id === a.id)!;
    assert.deepEqual(art.sources, [{ url: "https://www.youtube.com/watch?v=VQy50fuxI34", title: "Evals" }]);

    const [s1, s2] = await Promise.all([outputs.claim("skill", art), outputs.claim("skill", art)]);
    assert.ok((s1 === null) !== (s2 === null), "one claim wins");
    const skillId = (s1 ?? s2)!;
    await outputs.finishSkill(skillId, {
      skill_markdown: "---\nname: check-first\ndescription: \"x\"\n---\n\nbody\n", supporting_refs: art.sources,
      action_items: [{ task: "Add a failing test", applicability_evidence: [], prerequisites: [], steps: ["Inspect"], source_refs: [ready], completion_check: "It fails, then passes" }],
    });
    const items = (await pool.query(`SELECT task, position FROM action_items WHERE skill_result_id = $1`, [skillId])).rows;
    assert.deepEqual(items, [{ task: "Add a failing test", position: 0 }]);
    assert.ok(!(await outputs.artifactsNeeding("skill", 500)).some((x) => x.id === a.id));

    const videoId = (await outputs.claim("video", art))!;
    await assert.rejects(pool.query(`UPDATE video_results SET status = 'ready' WHERE id = $1`, [videoId]), /video_ready_has_media/);
    await outputs.finishVideo(videoId, {
      script: { scenes: [] }, prompt_revision: "script-v1", media_ref: `r2:videos/${a.id}/1/short.mp4`,
      caption_ref: `r2:captions/${a.id}/1/short.vtt`, narration_ref: `r2:audio/${a.id}/1/narration.m4a`, duration_seconds: 34.5,
    });
    const v = (await pool.query(`SELECT status, music_ref, duration_seconds FROM video_results WHERE id = $1`, [videoId])).rows[0];
    assert.deepEqual(v, { status: "ready", music_ref: null, duration_seconds: "34.50" });
    assert.equal(await outputs.claim("video", art), null, "a ready video isn't redone");
  } finally {
    for (const id of made.artifacts) {
      await pool.query(`DELETE FROM action_items WHERE skill_result_id IN (SELECT id FROM skill_results WHERE artifact_id = $1)`, [id]);
      await pool.query(`DELETE FROM skill_results WHERE artifact_id = $1`, [id]);
      await pool.query(`DELETE FROM video_results WHERE artifact_id = $1`, [id]);
    }
    await pool.query(`DELETE FROM artifacts WHERE source_ids && $1::uuid[]`, [made.units]);
    await pool.query(`DELETE FROM user_imports WHERE user_id = $1`, [made.user]);
    await pool.query(`DELETE FROM ingested_units WHERE id = ANY($1::uuid[])`, [made.units]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [made.user]);
    if (made.prompt) await pool.query(`DELETE FROM digestion_prompts WHERE id = $1`, [made.prompt]);
    await pool.end();
  }
});
