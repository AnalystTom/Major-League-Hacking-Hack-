import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { testDatabase } from '../../server/test/db/helpers.ts';
import { D1Store } from '../../server/src/ingest/store.ts';
import { DEFAULT_CATEGORIZATION_REQUEST, promptRevisionText } from '../../server/src/ingest/digest/contract.ts';
import app from '../../web/src/index.js';
import { connect } from '../../web/src/db.js';
import { readUnits } from '../../web/src/imports.js';
import { followImports } from '../../web/public/units.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('a cold processor Worker registers the revision before accepting a fresh import and polling continues', { timeout: 10000 }, async (t) => {
  const { db, sqlite } = testDatabase();
  const registration = deferred(), registrationEntered = deferred(), cold = deferred(), forwarding = deferred();
  const jobs = [];
  const ctx = { waitUntil: (job) => jobs.push(job) };
  let blockRegistration = true, containerBegan = false, forwardedBody, forwards = 0;
  const processor = {
    async useSettings() {},
    async settingsStatus() { return { container: 'stopped', running: false }; },
    async fetch(request) {
      forwards++;
      forwarding.resolve();
      await cold.promise;
      containerBegan = true;
      if (request.method === 'POST') forwardedBody = await request.json();
      return Response.json({ accepted: true }, { status: 202 });
    },
  };
  t.mock.module('@cloudflare/containers', { namedExports: { Container: class {}, getContainer: () => processor } });
  const { default: worker } = await import('./src/index.js');
  const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: timingSafeEqual });
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  const binding = {
    prepare(sql) {
      return { bind(...params) { return { sql, params, async all() { return { results: sqlite.prepare(sql).all(...params) }; } }; } };
    },
    async batch(statements) {
      if (blockRegistration) {
        registrationEntered.resolve();
        await registration.promise;
        blockRegistration = false;
      }
      return (await db.batch(statements)).map(({ rows, rowCount }) => ({ success: true, results: rows, meta: { changes: rowCount } }));
    },
  };
  const host = { DB: binding, INGEST_TOKEN: 'test-token', OPENAI_API_KEY: 'test-only', PROCESSOR: {} };
  const env = { DB: binding, PROCESSOR_URL: 'https://processor/api/ingest/process', PROCESSOR_TOKEN: host.INGEST_TOKEN,
    PROCESSOR: { fetch: (url, init) => worker.fetch(new Request(url, init), host, ctx) } };
  const call = (path, body, cookie) => app.fetch(new Request(`http://app${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, {});
  let imported;
  try {
    const store = new D1Store(db);
    const post = JSON.parse(readFileSync(new URL('../../server/test/ingest/fixtures/xpost-2111437891322745223.json', import.meta.url), 'utf8'));
    const url = `https://x.com/i/status/${post.id_str}`;
    const unit = { id: randomUUID(), submittedUrl: url, sourceUrl: url, startSeconds: null, title: null, contentType: 'x_post',
      transcript: { window: [0, 0], evidence_items: [{ start_seconds: 0, end_seconds: 0, observed_spoken_content: post.text }] },
      extractionMethod: 'x-embed:tweet-result', extractedAt: new Date(), status: 'ready', error: null };
    await store.saveUnit(unit);
    const old = await store.registerPrompt('Engineering only', []);
    await store.saveArtifacts([], [{ unit_id: unit.id, reason: 'Not an engineering problem.' }], old);
    const signup = await call('/api/auth/signup', { email: 'cold@example.com', password: 'correct horse battery' });
    assert.equal(signup.status, 201);
    const cookie = signup.headers.get('set-cookie').split(';')[0];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let accepted = false;
    imported = call('/api/imports', { links: [url] }, cookie).then((response) => { accepted = true; return response; });
    await registrationEntered.promise;
    t.mock.timers.tick(6000);
    assert.equal(accepted, false);
    assert.equal(forwards, 0);
    registration.resolve();
    await forwarding.promise;
    t.mock.timers.tick(6000);
    const response = await imported;
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.processor, 'requested');
    assert.equal(containerBegan, false);
    assert.deepEqual(result.units.map(({ stage, settled, error }) => ({ stage, settled, error })), [{ stage: 'digesting', settled: false, error: null }]);
    const prompts = (await db.query('SELECT id,prompt_text FROM digestion_prompts ORDER BY revision')).rows;
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1].prompt_text, promptRevisionText(DEFAULT_CATEGORIZATION_REQUEST));
    assert.deepEqual(await store.unitsNeedingDigest([unit.id], prompts[1].id), [unit.id]);

    const firstPoll = deferred(), secondPoll = deferred(), errors = [], progress = [];
    t.mock.method(globalThis, 'fetch', (input) => call(String(input), null, cookie));
    followImports({ onUnits: (units) => progress.push(units), onItems: () => (progress.length === 1 ? firstPoll : secondPoll).resolve(),
      onSkills: () => {}, onError: (error) => { errors.push(error); firstPoll.resolve(); secondPoll.resolve(); } });
    await firstPoll.promise;
    assert.deepEqual(errors, []);
    t.mock.timers.tick(4000);
    await secondPoll.promise;
    assert.deepEqual(errors, []);
    assert.equal(progress.length, 2);
    assert.ok(progress.every((units) => units[0].stage === 'digesting' && !units[0].settled && units[0].error === null));
    assert.equal(containerBegan, false);

    const current = await store.registerPrompt(promptRevisionText(DEFAULT_CATEGORIZATION_REQUEST), []);
    const excluded = { ...unit, id: randomUUID() }, successful = { ...unit, id: randomUUID() };
    await store.saveUnit(excluded);
    await store.saveUnit(successful);
    await store.saveArtifacts([], [{ unit_id: excluded.id, reason: 'Nothing to explain.' }], current);
    await store.saveArtifacts([{ name: 'A substantive source', source_ids: [successful.id], category: 'Writing', processed_text: post.text,
      evidence: [], selection_reason: 'Source evidence' }], [], old);
    const sql = connect(env);
    assert.deepEqual(await store.unitsNeedingDigest([excluded.id, successful.id], current), []);
    assert.equal((await db.query('SELECT count(*) AS n FROM digestion_prompts')).rows[0].n, 2);
    const cli = await store.registerPrompt(promptRevisionText('Custom CLI request B'), []);
    assert.notEqual(cli, current);
    await store.registerPrompt(promptRevisionText(DEFAULT_CATEGORIZATION_REQUEST), [{ source: 'CLI example' }]);
    assert.equal(await store.findPrompt(promptRevisionText(DEFAULT_CATEGORIZATION_REQUEST), []), current);
    assert.deepEqual(await store.unitsNeedingDigest([excluded.id, successful.id], current), []);
    const exclusion = (await readUnits(sql, [excluded.id], [excluded.id], env))[0];
    assert.deepEqual([exclusion.stage, exclusion.settled, exclusion.error], ['not_selected', true, 'Nothing to explain.']);
    assert.equal((await readUnits(sql, [successful.id], [successful.id], env))[0].stage, 'rendering');
    assert.equal(containerBegan, false);

    const configured = { ...host, DIGESTION_REQUEST: 'Configured processor request A' };
    const configuredId = await store.registerPrompt(promptRevisionText(configured.DIGESTION_REQUEST), []);
    await store.registerPrompt(promptRevisionText('Another custom CLI request B'), []);
    await store.saveArtifacts([], [{ unit_id: excluded.id, reason: 'Nothing to explain under configured A.' }], configuredId);
    const configuredEnv = { ...env, PROCESSOR: { fetch: (url, init) => worker.fetch(new Request(url, init), configured, ctx) } };
    const configuredExclusion = (await readUnits(sql, [excluded.id], [excluded.id], configuredEnv))[0];
    assert.deepEqual([configuredExclusion.stage, configuredExclusion.settled, configuredExclusion.error],
      ['not_selected', true, 'Nothing to explain under configured A.']);
    assert.deepEqual(await store.unitsNeedingDigest([excluded.id, successful.id], configuredId), []);
    assert.equal((await readUnits(sql, [successful.id], [successful.id], configuredEnv))[0].stage, 'rendering');

    let failedRegistrations = 0;
    const failedHost = { ...host, DB: { ...binding, async batch() { failedRegistrations++; throw new Error('D1 offline'); } } };
    const request = () => new Request('https://processor/api/ingest/process', { method: 'POST', headers: { authorization: `Bearer ${host.INGEST_TOKEN}` },
      body: JSON.stringify({ unit_ids: [unit.id] }) });
    const before = forwards;
    const settings = await worker.fetch(new Request('https://processor/settings-status', { headers: { authorization: `Bearer ${host.INGEST_TOKEN}` } }), failedHost, ctx);
    assert.equal(settings.status, 200);
    assert.deepEqual(await settings.json(), { container: 'stopped', running: false });
    assert.equal(failedRegistrations, 0);
    assert.equal(forwards, before);
    await assert.rejects(worker.fetch(request(), failedHost, ctx), /D1 offline/);
    const scheduled = [];
    worker.scheduled({}, failedHost, { waitUntil: (job) => scheduled.push(job) });
    await assert.rejects(scheduled[0], /D1 offline/);
    assert.equal(failedRegistrations, 2);
    assert.equal(forwards, before);
    cold.resolve();
    await Promise.all(jobs);
    assert.deepEqual(forwardedBody, { unit_ids: [unit.id] });
  } finally {
    registration.resolve();
    cold.resolve();
    await imported?.catch(() => {});
    await Promise.allSettled(jobs);
    t.mock.timers.reset();
    if (descriptor) Object.defineProperty(crypto.subtle, 'timingSafeEqual', descriptor);
    else delete crypto.subtle.timingSafeEqual;
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else delete globalThis.document;
    sqlite.close();
  }
});
