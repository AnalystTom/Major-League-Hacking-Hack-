import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import app from '../src/index.js';
import { connect } from '../src/db.js';
import { createSession } from '../src/auth.js';
import { readFeed } from '../src/feed.js';
import { deleteAccount } from '../src/account.js';
import { reserveVideo } from '../src/video-requests.js';
import { createUnits } from '../src/imports.js';

const MIGRATIONS = [
  '0002_application.sql', '0003_video_duration.sql', '0004_usage_events.sql', '0005_skill_choices.sql',
  '0005_x_oauth.sql', '0006_x_read_budget.sql', '0007_video_limits.sql', '0008_signup_events.sql',
  '0009_video_rejection_releases.sql', '0010_anonymous_spend_ledgers.sql',
];
const A = 'user-a';
const B = 'user-b';

function database({ mediaDelete } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of MIGRATIONS) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const statement = (text, params) => ({
    bind: (...values) => statement(text, values),
    all: async () => ({ results: sqlite.prepare(text).all(...params) }),
    run: () => sqlite.prepare(text).run(...params),
  });
  const DB = {
    prepare: (text) => statement(text, []),
    batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((s) => s.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
  const deleted = [];
  const MEDIA = {
    async delete(key) {
      if (mediaDelete) return mediaDelete(key);
      deleted.push(key);
    },
  };
  const env = {
    DB, MEDIA, SHORTS: 'on',
    USER_DAILY_IMPORT_LIMIT: '1000',
    SIGNUP_IP_DAILY_LIMIT: '1000',
    AUTH_LIMITER: { async limit() { return { success: true }; } },
    IMPORT_LIMITER: { async limit() { return { success: true }; } },
  };
  return { sqlite, env, deleted, sql: connect(env) };
}

function insert(sqlite, table, rows) {
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((c) => (row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]));
    sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...values);
  }
}

function seed(sqlite) {
  insert(sqlite, 'users', [
    { id: A, email: 'a@example.com', name: 'A', password_hash: 'x' },
    { id: B, email: 'b@example.com', name: 'B', password_hash: 'x' },
  ]);
  insert(sqlite, 'digestion_prompts', [{ id: 'prompt-1', revision: 1, prompt_text: 'p' }]);
  insert(sqlite, 'ingested_units', [
    { id: 'unit-a', submitted_url: 'https://x.com/a/status/1', source_url: 'https://x.com/a/status/1' },
    { id: 'unit-a2', submitted_url: 'https://x.com/a/status/2', source_url: 'https://x.com/a/status/2' },
    { id: 'unit-shared', submitted_url: 'https://youtu.be/shared?si=a-share-token', source_url: 'https://youtu.be/shared' },
    { id: 'unit-b', submitted_url: 'https://x.com/b/status/3', source_url: 'https://x.com/b/status/3' },
  ]);
  insert(sqlite, 'user_imports', [
    { user_id: A, unit_id: 'unit-a' },
    { user_id: A, unit_id: 'unit-a2' },
    { user_id: A, unit_id: 'unit-shared' },
    { user_id: B, unit_id: 'unit-shared' },
    { user_id: B, unit_id: 'unit-b' },
  ]);
  insert(sqlite, 'artifact_exclusions', [
    { unit_id: 'unit-a', digestion_prompt_id: 'prompt-1', reason: 'off-topic' },
    { unit_id: 'unit-b', digestion_prompt_id: 'prompt-1', reason: 'off-topic' },
  ]);
  insert(sqlite, 'processing_starts', [
    { unit_id: 'unit-a', kind: 'extract', charged: 1 },
    { unit_id: 'unit-b', kind: 'extract', charged: 1 },
  ]);
  insert(sqlite, 'artifacts', [
    { id: 'art-a', name: 'A only', source_url: 'https://x.com/a/status/1', source_ids: ['unit-a'], processed_text: 't', ingestion_status: 'ready' },
    { id: 'art-mixed', name: 'Mixed', source_url: 'https://x.com/a/status/2', source_ids: ['unit-a2', 'unit-b'], processed_text: 't', ingestion_status: 'ready' },
    { id: 'art-shared', name: 'Shared', source_url: 'https://youtu.be/shared', source_ids: ['unit-shared'], processed_text: 't', ingestion_status: 'ready' },
    { id: 'art-b', name: 'B only', source_url: 'https://x.com/b/status/3', source_ids: ['unit-b'], processed_text: 't', ingestion_status: 'ready' },
  ]);
  insert(sqlite, 'video_results', [
    { id: 'vid-a', artifact_id: 'art-a', artifact_version: 1, status: 'ready', duration_seconds: 12, media_ref: 'r2:videos/art-a/1/short.mp4', caption_ref: 'r2:captions/art-a/1/short.vtt', narration_ref: 'r2:audio/art-a/1/narration.m4a', music_ref: 'https://example.com/music.mp3' },
    { id: 'vid-shared', artifact_id: 'art-shared', artifact_version: 1, status: 'ready', duration_seconds: 12, media_ref: 'r2:videos/art-shared/1/short.mp4', caption_ref: 'r2:captions/art-shared/1/short.vtt', narration_ref: 'r2:audio/art-shared/1/narration.m4a' },
    { id: 'vid-b', artifact_id: 'art-b', artifact_version: 1, status: 'ready', duration_seconds: 12, media_ref: 'r2:videos/art-b/1/short.mp4', caption_ref: 'r2:captions/art-b/1/short.vtt', narration_ref: 'r2:audio/art-b/1/narration.m4a' },
    { id: 'vid-mixed', artifact_id: 'art-mixed', artifact_version: 1, status: 'ready', duration_seconds: 12, media_ref: 'r2:videos/art-mixed/1/short.mp4', caption_ref: 'r2:captions/art-mixed/1/short.vtt', narration_ref: 'r2:audio/art-mixed/1/narration.m4a', review_status: 'approved', review_feedback: { judge: 'short-judge-v1', passed: 1, captions_burned: 1 }, feed_order: 1 },
  ]);
  insert(sqlite, 'skill_results', [
    { id: 'skill-a', artifact_id: 'art-a', artifact_version: 1, status: 'ready', skill_markdown: '# a' },
    { id: 'skill-shared', artifact_id: 'art-shared', artifact_version: 1, status: 'ready', skill_markdown: '# shared' },
    { id: 'skill-b', artifact_id: 'art-b', artifact_version: 1, status: 'ready', skill_markdown: '# b' },
  ]);
  insert(sqlite, 'action_items', [
    { id: 'item-a', skill_result_id: 'skill-a', task: 'do a', completion_check: 'a done' },
    { id: 'item-b', skill_result_id: 'skill-b', task: 'do b', completion_check: 'b done' },
  ]);
  insert(sqlite, 'handoffs', [
    { id: 'handoff-a', skill_result_id: 'skill-a', action_item_id: 'item-a', payload: {}, destination: 'agent', idempotency_key: 'key-a' },
    { id: 'handoff-b', skill_result_id: 'skill-b', action_item_id: 'item-b', payload: {}, destination: 'agent', idempotency_key: 'key-b' },
  ]);
  insert(sqlite, 'user_skill_choices', [
    { user_id: A, artifact_id: 'art-a', artifact_version: 1, kept: 1, video_requested: 1 },
    { user_id: A, artifact_id: 'art-shared', artifact_version: 1, kept: 1, video_requested: 0 },
    { user_id: B, artifact_id: 'art-shared', artifact_version: 1, kept: 1, video_requested: 1 },
    { user_id: B, artifact_id: 'art-b', artifact_version: 1, kept: 1, video_requested: 0 },
  ]);
  insert(sqlite, 'user_video_requests', [
    { user_id: A, artifact_id: 'art-a', artifact_version: 1 },
    { user_id: B, artifact_id: 'art-b', artifact_version: 1 },
  ]);
  insert(sqlite, 'video_starts', [
    { claim_token: 'claim-a', artifact_id: 'art-a', artifact_version: 1 },
    { claim_token: 'claim-b', artifact_id: 'art-b', artifact_version: 1 },
  ]);
  insert(sqlite, 'agent_briefs', [
    { id: 'brief-a', user_id: A, skill_result_ids: ['skill-a'], input_key: 'key-a' },
    { id: 'brief-b', user_id: B, skill_result_ids: ['skill-b'], input_key: 'key-b' },
    { id: 'brief-shared', user_id: B, skill_result_ids: ['skill-shared'], input_key: 'key-shared' },
  ]);
  insert(sqlite, 'x_connections', [
    { x_user_id: 'x-a', user_id: A, username: 'a', access_token: 'token-a', expires_at: 0 },
    { x_user_id: 'x-b', user_id: B, username: 'b', access_token: 'token-b', expires_at: 0 },
  ]);
  insert(sqlite, 'x_seen_bookmarks', [
    { user_id: A, post_id: '1' },
    { user_id: B, post_id: '3' },
  ]);
  insert(sqlite, 'x_read_requests', [
    { day: '2026-11-17', user_key: A },
    { day: '2026-11-17', user_key: B },
  ]);
  insert(sqlite, 'x_oauth_attempts', [
    { state_hash: 'state-a', browser_hash: 'browser-a', verifier: 'v', user_id: A, expires_at: 1 },
    { state_hash: 'state-b', browser_hash: 'browser-b', verifier: 'v', user_id: B, expires_at: 1 },
  ]);
}

const count = (sqlite, text, ...params) => sqlite.prepare(text).get(...params).n;

function rowsMentioning(sqlite, text) {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  return tables.flatMap((table) => sqlite.prepare(`SELECT * FROM ${table}`).all()
    .filter((row) => JSON.stringify(row).includes(text))
    .map(() => table));
}

const publicFeedSources = async (sql) => (await readFeed(sql)).map((item) => ({ id: item.id, source_url: item.source_url }));

function userRowCounts(sqlite, userId) {
  return Object.fromEntries([
    'sessions', 'user_imports', 'agent_briefs', 'x_connections', 'x_seen_bookmarks',
    'x_oauth_attempts', 'user_skill_choices', 'user_video_requests',
  ].map((table) => [table, count(sqlite, `SELECT count(*) AS n FROM ${table} WHERE user_id = ?`, userId)]));
}

const request = (method, path, { cookie, contentType = 'application/json' } = {}) => new Request(`http://localhost${path}`, {
  method,
  headers: { ...(contentType ? { 'content-type': contentType } : {}), ...(cookie ? { cookie } : {}) },
  ...(method === 'DELETE' ? { body: '{}' } : {}),
});

test('DELETE /api/me removes every artifact built from the account units and every row that references them', async () => {
  const { sqlite, env, deleted, sql } = database();
  try {
    seed(sqlite);
    const tokenA = await createSession(sql, A);
    await createSession(sql, A);
    const tokenB = await createSession(sql, B);
    const cookieA = `rs_session=${tokenA}`;
    const cookieB = `rs_session=${tokenB}`;

    assert.ok((await publicFeedSources(sql)).some((item) => item.id === 'art-mixed'), 'mixed artifact is public before deletion');

    const response = await app.fetch(request('DELETE', '/api/me', { cookie: cookieA }), env, {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true });
    assert.match(response.headers.get('set-cookie'), /^rs_session=;.*Max-Age=0/);

    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM users WHERE id = ?', A), 0);
    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM x_read_requests WHERE user_key = ?', A), 0);
    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM x_read_requests WHERE user_key = ?', B), 1);
    assert.deepEqual(userRowCounts(sqlite, A), {
      sessions: 0, user_imports: 0, agent_briefs: 0, x_connections: 0, x_seen_bookmarks: 0,
      x_oauth_attempts: 0, user_skill_choices: 0, user_video_requests: 0,
    });

    for (const [table, where] of [
      ['artifacts', "id = 'art-a'"],
      ['artifacts', "id = 'art-mixed'"],
      ['artifacts', "id = 'art-shared'"],
      ['video_results', "artifact_id = 'art-a'"],
      ['video_results', "artifact_id = 'art-mixed'"],
      ['video_results', "artifact_id = 'art-shared'"],
      ['skill_results', "artifact_id = 'art-a'"],
      ['skill_results', "artifact_id = 'art-shared'"],
      ['action_items', "skill_result_id = 'skill-a'"],
      ['handoffs', "skill_result_id = 'skill-a'"],
      ['video_starts', "artifact_id = 'art-a'"],
      ['user_skill_choices', "artifact_id = 'art-a'"],
      ['user_skill_choices', "artifact_id = 'art-shared'"],
      ['user_video_requests', "artifact_id = 'art-a'"],
      ['artifact_exclusions', "unit_id = 'unit-a'"],
      ['processing_starts', "unit_id = 'unit-a'"],
      ['ingested_units', "id = 'unit-a'"],
      ['ingested_units', "id = 'unit-a2'"],
      ['ingested_units', "id = 'unit-shared'"],
      ['user_imports', "unit_id = 'unit-shared'"],
      ['agent_briefs', "id = 'brief-shared'"],
    ]) {
      assert.equal(count(sqlite, `SELECT count(*) AS n FROM ${table} WHERE ${where}`), 0, `${table} still holds ${where}`);
    }

    assert.deepEqual([...deleted].sort(), [
      'audio/art-a/1/narration.m4a', 'audio/art-mixed/1/narration.m4a', 'audio/art-shared/1/narration.m4a',
      'captions/art-a/1/short.vtt', 'captions/art-mixed/1/short.vtt', 'captions/art-shared/1/short.vtt',
      'videos/art-a/1/short.mp4', 'videos/art-mixed/1/short.mp4', 'videos/art-shared/1/short.mp4',
    ]);

    assert.deepEqual(userRowCounts(sqlite, B), {
      sessions: 1, user_imports: 1, agent_briefs: 1, x_connections: 1, x_seen_bookmarks: 1,
      x_oauth_attempts: 1, user_skill_choices: 1, user_video_requests: 1,
    });
    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM artifacts'), 1);
    assert.equal(count(sqlite, "SELECT count(*) AS n FROM artifacts WHERE id = 'art-b'"), 1);
    assert.deepEqual(sqlite.prepare('SELECT id FROM ingested_units ORDER BY id').all().map((r) => r.id), ['unit-b']);
    assert.equal(count(sqlite, "SELECT count(*) AS n FROM video_results WHERE id IN ('vid-b')"), 1);
    assert.equal(count(sqlite, "SELECT count(*) AS n FROM skill_results WHERE id IN ('skill-b')"), 1);
    assert.equal(count(sqlite, "SELECT count(*) AS n FROM handoffs WHERE id IN ('handoff-b')"), 1);
    assert.equal(count(sqlite, "SELECT count(*) AS n FROM artifact_exclusions WHERE unit_id = 'unit-b'"), 1);
    assert.equal(count(sqlite, "SELECT count(*) AS n FROM processing_starts WHERE unit_id = 'unit-b'"), 1);
    assert.deepEqual(rowsMentioning(sqlite, 'a-share-token'), []);
    assert.deepEqual(rowsMentioning(sqlite, 'https://x.com/a/status/'), []);
    assert.deepEqual(rowsMentioning(sqlite, 'youtu.be/shared'), []);
    assert.deepEqual((await publicFeedSources(sql)).filter((item) => ['art-mixed', 'art-shared'].includes(item.id)), []);

    assert.deepEqual(await (await app.fetch(request('GET', '/api/me', { cookie: cookieA }), env, {})).json(), { user: null });
    const bImports = await (await app.fetch(request('GET', '/api/imports', { cookie: cookieB }), env, {})).json();
    assert.equal(bImports.units.length, 1);
    assert.equal((await app.fetch(request('GET', '/api/me', { cookie: cookieB }), env, {})).status, 200);
  } finally {
    sqlite.close();
  }
});

test('DELETE /api/me needs a signed-in session and a JSON body, and keeps the account when media deletion fails', async () => {
  const { sqlite, env, sql } = database({ mediaDelete: async () => { throw new Error('r2 unavailable'); } });
  try {
    seed(sqlite);
    const tokenA = await createSession(sql, A);
    const cookieA = `rs_session=${tokenA}`;

    assert.equal((await app.fetch(request('DELETE', '/api/me'), env, {})).status, 401);
    assert.equal((await app.fetch(request('DELETE', '/api/me', { cookie: cookieA, contentType: 'text/plain' }), env, {})).status, 415);

    const failed = await app.fetch(request('DELETE', '/api/me', { cookie: cookieA }), env, {});
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: "We couldn't delete your account right now. Please try again." });
    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM users WHERE id = ?', A), 1);
    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM artifacts WHERE id = ?', 'art-a'), 1);
    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM sessions WHERE user_id = ?', A), 1);
  } finally {
    sqlite.close();
  }
});

test('an import committed after the artifact read is removed with the account', async () => {
  const { sqlite, env } = database();
  try {
    seed(sqlite);
    let raced = false;
    const racingEnv = {
      ...env,
      DB: {
        prepare: (text) => ({
          ...env.DB.prepare(text),
          bind: (...values) => {
            const bound = env.DB.prepare(text).bind(...values);
            return {
              ...bound,
              all: async () => {
                const result = await bound.all();
                if (!raced) {
                  raced = true;
                  insert(sqlite, 'ingested_units', [{ id: 'unit-race', submitted_url: 'https://x.com/a/status/9', source_url: 'https://x.com/a/status/9' }]);
                  insert(sqlite, 'user_imports', [{ user_id: A, unit_id: 'unit-race' }]);
                }
                return result;
              },
            };
          },
        }),
        batch: (statements) => env.DB.batch(statements),
      },
    };
    await deleteAccount(racingEnv, A);
    assert.equal(raced, true);
    assert.equal(count(sqlite, "SELECT count(*) AS n FROM ingested_units WHERE id = 'unit-race'"), 0);
    assert.deepEqual(rowsMentioning(sqlite, 'https://x.com/a/status/9'), []);
  } finally {
    sqlite.close();
  }
});

test('deleting an account keeps its spend in the global caps without linking it to the account', async () => {
  const { sqlite, env } = database();
  try {
    seed(sqlite);
    const spend = () => ({
      video_starts: count(sqlite, 'SELECT count(*) AS n FROM video_starts'),
      user_video_requests: count(sqlite, 'SELECT count(*) AS n FROM user_video_requests'),
      charged_processing_starts: count(sqlite, 'SELECT count(*) AS n FROM processing_starts WHERE charged = 1'),
      x_read_requests: count(sqlite, 'SELECT count(*) AS n FROM x_read_requests'),
    });
    const seededSpend = { video_starts: 2, user_video_requests: 2, charged_processing_starts: 2, x_read_requests: 2 };
    assert.deepEqual(spend(), seededSpend);

    await deleteAccount(env, A);

    assert.deepEqual(spend(), seededSpend);
    assert.equal(count(sqlite, "SELECT count(*) AS n FROM video_starts WHERE claim_token = 'claim-a' AND artifact_id IS NULL AND artifact_version IS NULL"), 1);
    assert.equal(count(sqlite, "SELECT count(*) AS n FROM user_video_requests WHERE user_id IS NULL AND artifact_id IS NULL"), 1);
    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM processing_starts WHERE charged = 1 AND unit_id IS NULL'), 1);
    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM x_read_requests WHERE user_key IS NULL'), 1);
    assert.deepEqual(rowsMentioning(sqlite, A), []);
  } finally {
    sqlite.close();
  }
});

test("deleting an account releases another user's video slot on a shared artifact", async () => {
  const { sqlite, env, sql } = database();
  try {
    seed(sqlite);
    insert(sqlite, 'ingested_units', [{ id: 'unit-b2', submitted_url: 'https://x.com/b/status/4', source_url: 'https://x.com/b/status/4' }]);
    insert(sqlite, 'user_imports', [{ user_id: B, unit_id: 'unit-b2' }]);
    insert(sqlite, 'artifacts', [{ id: 'art-b2', name: 'B second', source_url: 'https://x.com/b/status/4', source_ids: ['unit-b2'], processed_text: 't', ingestion_status: 'ready' }]);
    sqlite.exec("DELETE FROM user_video_requests WHERE user_id = 'user-b'");
    const requested = await reserveVideo(sql, B, { id: 'art-shared', version: 1 }, env);
    assert.equal(requested.video.artifact.id, 'art-shared');

    await deleteAccount(env, A);

    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM user_video_requests WHERE user_id = ?', B), 0);
    const next = await reserveVideo(sql, B, { id: 'art-b2', version: 1 }, env);
    assert.equal(next.video.artifact.id, 'art-b2');
  } finally {
    sqlite.close();
  }
});

test('an import whose user is deleted before its link commits leaves no unit behind', async () => {
  const { sqlite, sql } = database();
  try {
    seed(sqlite);
    const link = { submitted_url: 'https://x.com/gone/status/7', source_url: 'https://x.com/gone/status/7', start_seconds: null, content_type: 'x_post' };
    await assert.rejects(createUnits(sql, [link], { userId: 'user-deleted-mid-import' }));
    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM ingested_units WHERE source_url = ?', link.source_url), 0);
    assert.equal(count(sqlite, 'SELECT count(*) AS n FROM ingested_units WHERE submitted_url = ?', link.submitted_url), 0);
  } finally {
    sqlite.close();
  }
});
