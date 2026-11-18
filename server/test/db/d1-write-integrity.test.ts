import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ALLOWED_D1_STATEMENTS } from '../../../deploy/processor/src/d1-allowlist.js';
import { bridgedDatabase } from './helpers.js';
import { D1Store } from '../../src/ingest/store.js';
import { D1OutputStore } from '../../src/outputs/store.js';
import { processUnits } from '../../src/ingest/processor.js';
import { reserveDigest } from '../../src/ingest/pipeline.js';
import { UNLIMITED } from '../../src/ingest/limits.js';
import { DEFAULT_CATEGORIZATION_REQUEST, promptRevisionText } from '../../src/ingest/digest/prompt.js';
import { mockFetch } from '../ingest/helpers.js';
import type { ReadyArtifact } from '../../src/outputs/types.js';

const allowed = (prefix: string) => {
  const matches = [...ALLOWED_D1_STATEMENTS].filter((sql) => sql.startsWith(prefix));
  assert.equal(matches.length, 1, `exactly one allow-listed statement starts with ${prefix}`);
  return matches[0];
};

const SAVE_UNIT = allowed('UPDATE ingested_units SET title=?2');
const RESERVE_EXTRACTIONS = allowed("INSERT INTO processing_starts(unit_id,kind,charged,batch_token)\n        SELECT id,'extract'");
const START_EXTRACTIONS = allowed("UPDATE ingested_units SET status='running',claimed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),deferred_until=NULL\n        WHERE id IN (SELECT unit_id FROM processing_starts WHERE batch_token=?1");
const RESERVE_DIGEST = allowed("INSERT INTO processing_starts(unit_id,kind,charged,batch_token)\n        SELECT ?3,'digest'");
const READY_ARTIFACT = allowed('INSERT INTO artifacts(name,source_url,source_ids,sources,processed_text');
const FAILED_ARTIFACT = allowed('INSERT INTO artifacts(name,source_url,source_ids,sources,digestion_prompt_id');
const EXCLUSION = allowed('INSERT INTO artifact_exclusions');
const RELEASE_VIDEO_REQUESTS = allowed('INSERT INTO video_rejection_releases');
const DROP_VIDEO_REQUESTS = allowed('DELETE FROM user_video_requests');

const SKILL = '---\nname: check-first\ndescription: Check the evidence first.\n---\nCheck the evidence first.';
const JUDGE_REJECTION = 'Quality judge rejected: unsupported claim';
const UNSPENT = [1000, 1000];

async function setup() {
  const { db, direct, sqlite } = bridgedDatabase();
  const store = new D1Store(db), outputs = new D1OutputStore(db);
  const user = (await direct.query("INSERT INTO users(email,password_hash) VALUES(?1,'x') RETURNING id", [`integrity-${randomUUID()}@example.test`])).rows[0].id as string;
  async function importVideo(videoId: string) {
    const id = randomUUID();
    await direct.query('INSERT INTO ingested_units(id,submitted_url,source_url) VALUES(?1,?2,?2)', [id, `https://www.youtube.com/watch?v=${videoId}`]);
    await direct.query('INSERT INTO user_imports(user_id,unit_id) VALUES(?1,?2)', [user, id]);
    return id;
  }
  const options = (fetchImpl: typeof fetch, { digest = true } = {}) =>
    ({ store, geminiKey: 'k', openaiKey: digest ? 'o' : undefined, fetchImpl, retries: 0, pollMs: 5, waitTimeoutMs: 2000, limits: UNLIMITED });
  const unit = async (id: string) => (await direct.query('SELECT * FROM ingested_units WHERE id=?1', [id])).rows[0];
  const count = async (sql: string, ...params: unknown[]) => Number((await direct.query(sql, params)).rows[0].n);
  const requestVideo = async (a: ReadyArtifact) => {
    await direct.query('INSERT INTO user_skill_choices(user_id,artifact_id,artifact_version,kept,video_requested) VALUES(?1,?2,?3,1,1)', [user, a.id, a.version]);
    await direct.query('INSERT INTO user_video_requests(user_id,artifact_id,artifact_version) VALUES(?1,?2,?3)', [user, a.id, a.version]);
  };
  const prompt = () => store.registerPrompt(promptRevisionText(DEFAULT_CATEGORIZATION_REQUEST), []);
  return { db, direct, sqlite, store, outputs, user, importVideo, options, unit, count, requestVideo, prompt };
}

test('the container write sequence passes the D1 bridge: extract, digest, skill, video claim and judge rejection', async () => {
  const s = await setup();
  try {
    const id = await s.importVideo('VQy50fuxI34');
    const summary = await processUnits([id], s.options(mockFetch().impl));
    assert.deepEqual(summary.extracted, { ready: 1, failed: 0 });
    assert.equal(summary.digested, 1);
    assert.equal((await s.unit(id)).status, 'ready');

    const [artifact] = await s.outputs.artifactsNeeding('skill', 5);
    assert.deepEqual(artifact.source_ids, [id]);
    const skill = (await s.outputs.claim('skill', artifact))!;
    assert.ok(skill, 'the container claims the skill');
    assert.equal(await s.outputs.heartbeat('skill', skill), true);
    await s.outputs.finishSkill(skill, { skill_markdown: SKILL, supporting_refs: [] } as never);
    assert.equal((await s.outputs.skillCard(artifact)).status, 'ready');

    await s.requestVideo(artifact);
    const video = (await s.outputs.claim('video', artifact, UNLIMITED))!;
    assert.ok(video, 'the container claims the requested video');
    assert.equal(await s.outputs.fail('video', video, JUDGE_REJECTION), true);
    assert.equal(await s.count('SELECT count(*) AS n FROM video_rejection_releases WHERE user_id=?1', s.user), 1);
    assert.equal(await s.count('SELECT count(*) AS n FROM user_video_requests'), 0, 'the rejected video gives the account its slot back');
  } finally { s.sqlite.close(); }
});

test('a failed digest is recorded from the unit row through the D1 bridge, and its artifact is never claimed for a skill', async () => {
  const s = await setup();
  try {
    const id = await s.importVideo('VQy50fuxI34');
    await processUnits([id], s.options(mockFetch({ digestStatus: () => 500 }).impl));
    const [failed] = (await s.direct.query("SELECT * FROM artifacts WHERE ingestion_status='failed'")).rows;
    const stored = await s.unit(id);
    assert.deepEqual(failed.source_ids, [id]);
    assert.equal(failed.source_url, stored.source_url);
    assert.deepEqual(failed.sources, [{ url: stored.source_url, title: stored.title, content_type: stored.content_type, retrieved_at: stored.extracted_at }]);
    assert.match(failed.error, /500/);
    assert.equal(await s.outputs.claim('skill', { ...failed, evidence: [] } as ReadyArtifact), null);
  } finally { s.sqlite.close(); }
});

test('a forged unit write cannot plant a unit under a caller-chosen id or overwrite a unit the container is not extracting', async () => {
  const s = await setup();
  try {
    const id = await s.importVideo('VQy50fuxI34');
    const leftover = await s.db.query(RESERVE_EXTRACTIONS, [...UNSPENT, JSON.stringify([id]), 'forger-token']);
    assert.equal(leftover.rowCount, 1, 'a pending unit is open to an extraction reservation, as for the container');
    await processUnits([id], s.options(mockFetch().impl));
    const before = await s.unit(id);
    assert.equal(before.status, 'ready');

    const planted = randomUUID();
    const plant = await s.db.query(SAVE_UNIT, [planted, 'Planted', '{"evidence_items":[]}', 'forged', new Date().toISOString(), 'ready', null]);
    assert.equal(plant.rowCount, 0);
    assert.equal(await s.count('SELECT count(*) AS n FROM ingested_units WHERE id=?1', planted), 0);

    const overwrite = await s.db.query(SAVE_UNIT, [id, 'Forged title', '{"evidence_items":[]}', 'forged', new Date().toISOString(), 'ready', null]);
    assert.equal(overwrite.rowCount, 0);

    const reopen = await s.db.query(START_EXTRACTIONS, ['forger-token']);
    assert.equal(reopen.rowCount, 0, 'an old extraction reservation cannot reopen a finished unit');
    const redigest = await s.db.query(RESERVE_DIGEST, [...UNSPENT, id, 'forger-token']);
    assert.equal(redigest.rowCount, 0, 'a digested unit its importer has seen cannot be reserved again');

    assert.deepEqual(await s.unit(id), before);
  } finally { s.sqlite.close(); }
});

test('forged artifact, failure and exclusion writes are refused without the container digest reservation', async () => {
  const s = await setup();
  try {
    const digested = await s.importVideo('VQy50fuxI34');
    await processUnits([digested], s.options(mockFetch().impl));
    const waiting = await s.importVideo('aaaaaaaaaaa');
    await processUnits([waiting], s.options(mockFetch().impl, { digest: false }));
    assert.equal((await s.unit(waiting)).status, 'ready');
    const prompt = await s.prompt();
    const artifacts = await s.count('SELECT count(*) AS n FROM artifacts');
    const forgedArtifact = (sourceIds: string[], reservation: string) => s.db.query(READY_ARTIFACT,
      ['Planted skill', JSON.stringify(sourceIds), 'forged text', 'Evals', 'forged', '[]', prompt, reservation]);

    for (const sources of [[waiting], [digested], [digested, waiting], [randomUUID()], []]) {
      assert.equal((await forgedArtifact(sources, randomUUID())).rowCount, 0, `artifact from ${sources.length} source(s)`);
    }
    assert.equal((await s.db.query(FAILED_ARTIFACT, [waiting, prompt, 'forged failure', randomUUID()])).rowCount, 0);
    assert.equal((await s.db.query(EXCLUSION, [waiting, prompt, 'forged exclusion', randomUUID()])).rowCount, 0);

    assert.equal(await s.count('SELECT count(*) AS n FROM artifacts'), artifacts);
    assert.equal(await s.count('SELECT count(*) AS n FROM artifact_exclusions'), 0);
    assert.deepEqual(await s.store.unitsNeedingDigest([waiting], prompt), [waiting], 'the waiting unit is still digested by the container');
  } finally { s.sqlite.close(); }
});

test('a ready artifact takes its attribution from the reserved unit rows', async () => {
  const s = await setup();
  try {
    const waiting = await s.importVideo('aaaaaaaaaaa');
    await processUnits([waiting], s.options(mockFetch().impl, { digest: false }));
    const unit = await s.unit(waiting);
    const token = randomUUID();
    assert.equal((await s.db.query(RESERVE_DIGEST, [...UNSPENT, waiting, token])).rowCount, 1);
    const prompt = await s.prompt();
    assert.equal((await s.db.query(READY_ARTIFACT, ['Real skill', JSON.stringify([waiting]), 'text', 'Evals', 'reason', '[]', prompt, token])).rowCount, 1);
    const [row] = (await s.direct.query('SELECT source_url, sources FROM artifacts WHERE source_ids=?1', [JSON.stringify([waiting])])).rows;
    assert.equal(row.source_url, unit.source_url);
    assert.deepEqual(row.sources, [{ url: unit.source_url, title: unit.title, content_type: unit.content_type, retrieved_at: unit.extracted_at }]);
  } finally { s.sqlite.close(); }
});

test('a two-source ready artifact takes its URL from the first source and keeps source_ids order', async () => {
  const s = await setup();
  try {
    const earlier = await s.importVideo('aaaaaaaaaaa');
    const first = await s.importVideo('VQy50fuxI34');
    await processUnits([earlier, first], s.options(mockFetch().impl, { digest: false }));
    const [unitEarlier, unitFirst] = [await s.unit(earlier), await s.unit(first)];
    const token = randomUUID();
    for (const id of [first, earlier]) assert.equal((await s.db.query(RESERVE_DIGEST, [...UNSPENT, id, token])).rowCount, 1);
    const prompt = await s.prompt();
    assert.equal((await s.db.query(READY_ARTIFACT, ['Joint skill', JSON.stringify([first, earlier]), 'text', 'Evals', 'reason', '[]', prompt, token])).rowCount, 1);
    const [row] = (await s.direct.query('SELECT source_url, sources FROM artifacts WHERE source_ids=?1', [JSON.stringify([first, earlier])])).rows;
    assert.equal(row.source_url, unitFirst.source_url);
    assert.deepEqual(row.sources, [
      { url: unitFirst.source_url, title: unitFirst.title, content_type: unitFirst.content_type, retrieved_at: unitFirst.extracted_at },
      { url: unitEarlier.source_url, title: unitEarlier.title, content_type: unitEarlier.content_type, retrieved_at: unitEarlier.extracted_at },
    ]);
  } finally { s.sqlite.close(); }
});

test('a new link cannot be created through the D1 bridge and leaves no unit behind', async () => {
  const s = await setup();
  try {
    const link = randomUUID();
    const unit = { id: link, submittedUrl: 'https://www.youtube.com/watch?v=VQy50fuxI34', sourceUrl: 'https://www.youtube.com/watch?v=VQy50fuxI34', startSeconds: null, title: 'New', transcript: null, extractionMethod: 'gemini', extractedAt: new Date(), status: 'failed' as const, error: 'x' };
    await assert.rejects(s.store.saveUnit(unit), /unit .* does not exist: new links cannot be created through the D1 bridge/);
    assert.equal(await s.count('SELECT count(*) AS n FROM ingested_units WHERE id=?1', link), 0);
  } finally { s.sqlite.close(); }
});

test('a digest reservation with a unit its importer has already seen fails instead of dropping it silently', async () => {
  const s = await setup();
  try {
    const digested = await s.importVideo('VQy50fuxI34');
    await processUnits([digested], s.options(mockFetch().impl));
    await assert.rejects(reserveDigest(s.store, await s.store.getUnits([digested])), /1 unit\(s\) already have a digest/);
    const waiting = await s.importVideo('aaaaaaaaaaa');
    await processUnits([waiting], s.options(mockFetch().impl, { digest: false }));
    const reserved = await reserveDigest(s.store, await s.store.getUnits([waiting]));
    assert.deepEqual(reserved.units.map((u) => u.id), [waiting]);
  } finally { s.sqlite.close(); }
});

test('a forged video release cannot drop an account video request while the container holds the claim', async () => {
  const s = await setup();
  try {
    const id = await s.importVideo('VQy50fuxI34');
    await processUnits([id], s.options(mockFetch().impl));
    const [artifact] = await s.outputs.artifactsNeeding('skill', 5);
    await s.requestVideo(artifact);
    const video = (await s.outputs.claim('video', artifact, UNLIMITED))!;

    const release = await s.db.query(RELEASE_VIDEO_REQUESTS, [video.id, 'forger-token', JUDGE_REJECTION]);
    assert.equal(release.rowCount, 0);
    assert.equal((await s.db.query(DROP_VIDEO_REQUESTS, ['forger-token'])).rowCount, 0);
    assert.equal(await s.count('SELECT count(*) AS n FROM user_video_requests WHERE user_id=?1', s.user), 1);
    assert.equal(await s.outputs.heartbeat('video', video), true, 'the container still holds its claim');
  } finally { s.sqlite.close(); }
});
