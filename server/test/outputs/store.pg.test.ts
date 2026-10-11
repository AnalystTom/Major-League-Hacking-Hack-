// Integration test: needs db/migrations 001-009 applied. Run with TEST_DATABASE_URL=postgres://... npm test.
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
    made.prompt = (await pool.query(`INSERT INTO digestion_prompts (name, revision, prompt_text) VALUES ($1, 1, $1) RETURNING id`, [`test-${randomUUID()}`])).rows[0].id;

    // A unit its processor abandoned mid-extraction is claimable again; a fresh claim is not.
    const stale = await unit("running", "now() - interval '1 hour'");
    const fresh = await unit("running", "now()");
    const listed = await store.listPendingUnitIds(500);
    assert.ok(listed.includes(stale) && !listed.includes(fresh));
    const claimed = await store.claimPendingUnits([stale, fresh]);
    assert.deepEqual(claimed.map((u) => u.id), [stale]);

    // A ready unit with no digest is retried until it has failed MAX_DIGEST_ATTEMPTS times.
    const ready = await unit("ready");
    assert.ok((await store.listUnitsNeedingDigest(500)).some((r) => r.unitId === ready));
    for (let i = 0; i < 3; i++) await store.saveFailedArtifacts([ready], "boom", made.prompt);
    assert.ok(!(await store.listUnitsNeedingDigest(500)).some((r) => r.unitId === ready));

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
    const skillClaim = (s1 ?? s2)!;
    await outputs.finishSkill(skillClaim, {
      skill_markdown: "---\nname: check-first\ndescription: \"x\"\n---\n\nbody\n", supporting_refs: art.sources,
      action_items: [{ task: "Add a failing test", applicability_evidence: [], prerequisites: [], steps: ["Inspect"], source_refs: [ready], completion_check: "It fails, then passes" }],
    });
    const items = (await pool.query(`SELECT task, position FROM action_items WHERE skill_result_id = $1`, [skillClaim.id])).rows;
    assert.deepEqual(items, [{ task: "Add a failing test", position: 0 }]);
    assert.ok(!(await outputs.artifactsNeeding("skill", 500)).some((x) => x.id === a.id));

    const videoClaim = (await outputs.claim("video", art))!;
    await assert.rejects(pool.query(`UPDATE video_results SET status = 'ready' WHERE id = $1`, [videoClaim.id]), /video_ready_has_media/);
    await outputs.finishVideo(videoClaim, {
      script: { scenes: [] }, prompt_revision: "script-v1", media_ref: `r2:videos/${a.id}/1/short.mp4`,
      caption_ref: `r2:captions/${a.id}/1/short.vtt`, narration_ref: `r2:audio/${a.id}/1/narration.m4a`, duration_seconds: 34.5,
    });
    const v = (await pool.query(`SELECT status, music_ref, duration_seconds FROM video_results WHERE id = $1`, [videoClaim.id])).rows[0];
    assert.deepEqual(v, { status: "ready", music_ref: null, duration_seconds: "34.50" });
    assert.equal(await outputs.claim("video", art), null, "a ready video isn't redone");

    // A failed skill waits RETRY_AFTER_MINUTES x attempts, is retried, and stops after MAX_OUTPUT_ATTEMPTS.
    const b = (await pool.query(
      `INSERT INTO artifacts (name, source_url, source_ids, sources, processed_text, category, evidence, digestion_prompt_id, ingestion_status)
       VALUES ('Retry me', 'https://www.youtube.com/watch?v=VQy50fuxI34', $1, '[]', 'text', 'Evals', '[]', $2, 'ready') RETURNING id, version`,
      [[ready], made.prompt])).rows[0];
    made.artifacts.push(b.id);
    const retry = { ...art, id: b.id, version: b.version };
    for (let attempt = 1; attempt <= 3; attempt++) {
      const c = (await outputs.claim("skill", retry))!;
      assert.ok(c, `attempt ${attempt} is claimed`);
      assert.ok(await outputs.fail("skill", c, `boom ${attempt}`));
      assert.equal(await outputs.claim("skill", retry), null, "not retried straight away");
      await pool.query(`UPDATE skill_results SET updated_at = now() - interval '1 hour' WHERE id = $1`, [c.id]);
    }
    const last = (await pool.query(`SELECT status, attempts, error FROM skill_results WHERE artifact_id = $1`, [b.id])).rows[0];
    assert.deepEqual(last, { status: "failed", attempts: 3, error: "boom 3" });
    assert.equal(await outputs.claim("skill", retry), null, "no fourth attempt");
    assert.ok(!(await outputs.artifactsNeeding("skill", 500)).some((x) => x.id === b.id));
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

test("a digest that also uses someone else's video doesn't count for a person who didn't import it", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  const pool = new pg.Pool({ connectionString: url });
  const store = new PgStore(pool);
  const users: string[] = [], units: string[] = [];
  let prompt = "";
  try {
    for (const who of ["a", "b"]) users.push((await pool.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`${who}-${randomUUID()}@example.com`])).rows[0].id);
    const [a, b] = users;
    const ready = async () => {
      const id = (await pool.query(`INSERT INTO ingested_units (submitted_url, source_url, status, transcript) VALUES ('u', 'https://www.youtube.com/watch?v=VQy50fuxI34', 'ready', '{"window":[0,300]}') RETURNING id`)).rows[0].id as string;
      units.push(id);
      return id;
    };
    const shared = await ready(), onlyA = await ready();
    await pool.query(`INSERT INTO user_imports (user_id, unit_id, created_at) VALUES ($1, $2, now() - interval '1 hour'), ($1, $3, now() - interval '1 hour'), ($4, $2, now())`, [a, shared, onlyA, b]);
    prompt = (await pool.query(`INSERT INTO digestion_prompts (name, revision, prompt_text) VALUES ($1, 1, $1) RETURNING id`, [`test-${randomUUID()}`])).rows[0].id;

    // A's digest combined both of A's videos. B imported only the shared one, so it doesn't count for B.
    await pool.query(`INSERT INTO artifacts (name, source_url, source_ids, processed_text, digestion_prompt_id, ingestion_status) VALUES ('combined', 'x', $1, 't', $2, 'ready')`, [[shared, onlyA], prompt]);
    assert.deepEqual(await store.unitsNeedingDigest([shared, onlyA]), [shared]);
    const listed = (await store.listUnitsNeedingDigest(500)).filter((r) => units.includes(r.unitId));
    assert.deepEqual(listed, [{ unitId: shared, userId: b }], "the sweep digests it in B's own batch");
    assert.equal((await store.newestImporters([shared])).get(shared), b);

    // Once there's a digest of the shared video alone, everyone who imported it can see one.
    await pool.query(`INSERT INTO artifacts (name, source_url, source_ids, processed_text, digestion_prompt_id, ingestion_status) VALUES ('alone', 'x', $1, 't', $2, 'ready')`, [[shared], prompt]);
    assert.deepEqual(await store.unitsNeedingDigest([shared, onlyA]), []);
  } finally {
    await pool.query(`DELETE FROM artifacts WHERE source_ids && $1::uuid[]`, [units]);
    await pool.query(`DELETE FROM user_imports WHERE user_id = ANY($1::uuid[])`, [users]);
    await pool.query(`DELETE FROM ingested_units WHERE id = ANY($1::uuid[])`, [units]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    if (prompt) await pool.query(`DELETE FROM digestion_prompts WHERE id = $1`, [prompt]);
    await pool.end();
  }
});

test("only the worker holding the current claim token can settle a result", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  const pool = new pg.Pool({ connectionString: url });
  const outputs = new PgOutputStore(pool);
  const ids = { unit: "", prompt: "", artifact: "" };
  try {
    ids.unit = (await pool.query(`INSERT INTO ingested_units (submitted_url, source_url, status, transcript) VALUES ('u', 'https://www.youtube.com/watch?v=VQy50fuxI34', 'ready', '{}') RETURNING id`)).rows[0].id;
    ids.prompt = (await pool.query(`INSERT INTO digestion_prompts (name, revision, prompt_text) VALUES ($1, 1, $1) RETURNING id`, [`test-${randomUUID()}`])).rows[0].id;
    const a = (await pool.query(`INSERT INTO artifacts (name, source_url, source_ids, processed_text, digestion_prompt_id, ingestion_status) VALUES ('x', 'x', $1, 't', $2, 'ready') RETURNING id, version`, [[ids.unit], ids.prompt])).rows[0];
    ids.artifact = a.id;
    const art = { ...a, name: "x", category: null, processed_text: "t", selection_reason: null, source_ids: [ids.unit], sources: [], evidence: [] };
    const video = { script: { scenes: [] }, prompt_revision: "r", media_ref: "r2:videos/x/1/short.mp4", caption_ref: "r2:captions/x/1/short.vtt", narration_ref: "r2:audio/x/1/narration.m4a", duration_seconds: 30 };

    const first = (await outputs.claim("video", art))!;
    assert.equal(await outputs.claim("video", art), null, "a live claim isn't taken");
    await pool.query(`UPDATE video_results SET updated_at = now() - interval '2 hours' WHERE id = $1`, [first.id]);
    const second = (await outputs.claim("video", art))!;
    assert.equal(second.id, first.id);
    assert.notEqual(second.token, first.token);

    await assert.rejects(outputs.finishVideo(first, video), /taken over by a newer worker/);
    assert.equal(await outputs.fail("video", first, "late failure"), false);
    await outputs.finishVideo(second, video);
    assert.equal((await pool.query(`SELECT status FROM video_results WHERE id = $1`, [first.id])).rows[0].status, "ready");

    const skill = (await outputs.claim("skill", art))!;
    await pool.query(`UPDATE skill_results SET claim_token = gen_random_uuid() WHERE id = $1`, [skill.id]);
    await assert.rejects(outputs.finishSkill(skill, { skill_markdown: "x", supporting_refs: [], action_items: [] }), /taken over/);
    assert.equal((await pool.query(`SELECT status FROM skill_results WHERE id = $1`, [skill.id])).rows[0].status, "running");
  } finally {
    if (ids.artifact) {
      await pool.query(`DELETE FROM skill_results WHERE artifact_id = $1`, [ids.artifact]);
      await pool.query(`DELETE FROM video_results WHERE artifact_id = $1`, [ids.artifact]);
      await pool.query(`DELETE FROM artifacts WHERE id = $1`, [ids.artifact]);
    }
    if (ids.unit) await pool.query(`DELETE FROM ingested_units WHERE id = $1`, [ids.unit]);
    if (ids.prompt) await pool.query(`DELETE FROM digestion_prompts WHERE id = $1`, [ids.prompt]);
    await pool.end();
  }
});

test("a retried output is charged against the limits and waits when there's no room", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  const pool = new pg.Pool({ connectionString: url });
  const outputs = new PgOutputStore(pool);
  const ids = { unit: "", prompt: "", artifact: "" };
  try {
    ids.unit = (await pool.query(`INSERT INTO ingested_units (submitted_url, source_url, status, transcript) VALUES ('u', 'https://www.youtube.com/watch?v=VQy50fuxI34', 'ready', '{}') RETURNING id`)).rows[0].id;
    ids.prompt = (await pool.query(`INSERT INTO digestion_prompts (name, revision, prompt_text) VALUES ($1, 1, $1) RETURNING id`, [`test-${randomUUID()}`])).rows[0].id;
    const a = (await pool.query(`INSERT INTO artifacts (name, source_url, source_ids, processed_text, digestion_prompt_id, ingestion_status) VALUES ('x', 'x', $1, 't', $2, 'ready') RETURNING id, version`, [[ids.unit], ids.prompt])).rows[0];
    ids.artifact = a.id;
    const art = { ...a, name: "x", category: null, processed_text: "t", selection_reason: null, source_ids: [ids.unit], sources: [], evidence: [] };
    const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM processing_starts WHERE charged AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
    const roomForOne = { daily: c.n + 1, monthly: 100_000 };
    const retries = async () => (await pool.query(`SELECT count(*)::int AS n FROM processing_starts WHERE unit_id = $1 AND kind = 'retry' AND charged`, [ids.unit])).rows[0].n;

    const first = (await outputs.claim("skill", art, roomForOne))!;
    assert.equal(await retries(), 0, "a first attempt is covered by the digest");
    await outputs.fail("skill", first, "OpenAI HTTP 500: boom");
    await pool.query(`UPDATE skill_results SET updated_at = now() - interval '1 hour' WHERE id = $1`, [first.id]);
    assert.equal(await outputs.claim("skill", art, { daily: c.n, monthly: 100_000 }), null, "no room: the retry waits");
    const second = (await outputs.claim("skill", art, roomForOne))!;
    assert.equal(await retries(), 1);
    await outputs.fail("skill", second, "TTS HTTP 402: Your prepayment credits are depleted", true);
    const row = (await pool.query(`SELECT status, attempts FROM skill_results WHERE id = $1`, [first.id])).rows[0];
    assert.deepEqual(row, { status: "failed", attempts: 3 }, "a final failure uses up its attempts");
    await pool.query(`UPDATE skill_results SET updated_at = now() - interval '1 hour' WHERE id = $1`, [first.id]);
    assert.equal(await outputs.claim("skill", art, { daily: 1_000_000, monthly: 1_000_000 }), null, "never retried");
  } finally {
    if (ids.artifact) {
      await pool.query(`DELETE FROM skill_results WHERE artifact_id = $1`, [ids.artifact]);
      await pool.query(`DELETE FROM artifacts WHERE id = $1`, [ids.artifact]);
    }
    if (ids.unit) await pool.query(`DELETE FROM ingested_units WHERE id = $1`, [ids.unit]);
    if (ids.prompt) await pool.query(`DELETE FROM digestion_prompts WHERE id = $1`, [ids.prompt]);
    await pool.end();
  }
});

test("an agent brief is charged as one 'handoff' start, and waits without room", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  const { PgHandoffStore } = await import("../../src/outputs/handoff-store.js");
  const pool = new pg.Pool({ connectionString: url });
  const handoffs = new PgHandoffStore(pool);
  const ids = { unit: "", prompt: "", artifact: "", skill: "" };
  try {
    ids.unit = (await pool.query(`INSERT INTO ingested_units (submitted_url, source_url, status, transcript) VALUES ('u', 'https://www.youtube.com/watch?v=VQy50fuxI34', 'ready', '{}') RETURNING id`)).rows[0].id;
    ids.prompt = (await pool.query(`INSERT INTO digestion_prompts (name, revision, prompt_text) VALUES ($1, 1, $1) RETURNING id`, [`test-${randomUUID()}`])).rows[0].id;
    ids.artifact = (await pool.query(`INSERT INTO artifacts (name, source_url, source_ids, processed_text, digestion_prompt_id, ingestion_status) VALUES ('x', 'x', $1, 't', $2, 'ready') RETURNING id`, [[ids.unit], ids.prompt])).rows[0].id;
    ids.skill = (await pool.query(`INSERT INTO skill_results (artifact_id, artifact_version, status, skill_markdown) VALUES ($1, 1, 'ready', '---\nname: x\n---\n') RETURNING id`, [ids.artifact])).rows[0].id;
    const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM processing_starts WHERE charged AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
    const claim = { id: randomUUID(), token: randomUUID(), skill_result_ids: [ids.skill] } as any;
    assert.ok((await handoffs.reserve(claim, { daily: c.n, monthly: 100_000 }))! > new Date(), "no room: when it opens up");
    assert.equal(await handoffs.reserve(claim, { daily: c.n + 1, monthly: 100_000 }), null);
    const n = (await pool.query(`SELECT count(*)::int AS n FROM processing_starts WHERE unit_id = $1 AND kind = 'handoff' AND charged`, [ids.unit])).rows[0].n;
    assert.equal(n, 1);
    // Skills that resolve to no source video can't be charged, so the brief isn't written: it fails closed.
    const orphan = { ...claim, skill_result_ids: [randomUUID()] };
    await assert.rejects(handoffs.reserve(orphan, { daily: 1_000_000, monthly: 1_000_000 }), /can't be charged/);
  } finally {
    if (ids.skill) await pool.query(`DELETE FROM skill_results WHERE id = $1`, [ids.skill]);
    if (ids.artifact) await pool.query(`DELETE FROM artifacts WHERE id = $1`, [ids.artifact]);
    if (ids.unit) await pool.query(`DELETE FROM ingested_units WHERE id = $1`, [ids.unit]);
    if (ids.prompt) await pool.query(`DELETE FROM digestion_prompts WHERE id = $1`, [ids.prompt]);
    await pool.end();
  }
});
