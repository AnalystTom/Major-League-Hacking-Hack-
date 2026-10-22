import test from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';

test('a cold Worker preserves the process body and settings diagnostics do not need D1', { timeout: 10000 }, async (t) => {
  let release, entered;
  const cold = new Promise((resolve) => { release = resolve; });
  const forwarding = new Promise((resolve) => { entered = resolve; });
  const jobs = [], paths = [];
  const ctx = { waitUntil: (job) => jobs.push(job) };
  let body, databaseCalls = 0;
  const processor = {
    async useSettings() {},
    async settingsStatus() { return { container: 'stopped', running: false }; },
    async fetch(request) {
      paths.push(new URL(request.url).pathname);
      entered();
      await cold;
      if (request.method === 'POST') body = await request.json();
      return Response.json({ accepted: true }, { status: 202 });
    },
  };
  t.mock.module('@cloudflare/containers', { namedExports: { Container: class {}, getContainer: () => processor } });
  const { default: worker } = await import('./src/index.js');
  const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: timingSafeEqual });
  const offline = () => { databaseCalls++; throw new Error('D1 offline'); };
  const env = { DB: { prepare: offline, batch: offline }, INGEST_TOKEN: 'test-token', OPENAI_API_KEY: 'test-only', PROCESSOR: {} };
  const headers = { authorization: `Bearer ${env.INGEST_TOKEN}`, 'content-type': 'application/json' };
  const payload = { unit_ids: ['d3f4e253-c7ca-4b64-9b03-f064ee1953bb'] };
  let pending;
  try {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    pending = worker.fetch(new Request('https://processor/api/ingest/process', { method: 'POST', headers, body: JSON.stringify(payload) }), env, ctx);
    await forwarding;
    t.mock.timers.tick(6000);
    const accepted = await pending;
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { accepted: true, starting: true });
    assert.equal(body, undefined);

    const settings = await worker.fetch(new Request('https://processor/settings-status', { headers }), env, ctx);
    assert.equal(settings.status, 200);
    assert.deepEqual(await settings.json(), { container: 'stopped', running: false });
    assert.deepEqual(paths, ['/api/ingest/process']);
    assert.equal(databaseCalls, 0);

    release();
    await Promise.all(jobs);
    assert.deepEqual(body, payload);
    worker.scheduled({}, env, ctx);
    await Promise.all(jobs);
    assert.deepEqual(paths, ['/api/ingest/process', '/health']);
    assert.equal(databaseCalls, 0);
  } finally {
    release();
    await pending?.catch(() => {});
    await Promise.allSettled(jobs);
    t.mock.timers.reset();
    if (descriptor) Object.defineProperty(crypto.subtle, 'timingSafeEqual', descriptor);
    else delete crypto.subtle.timingSafeEqual;
  }
});
