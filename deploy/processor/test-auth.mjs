import test from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { ALLOWED_D1_STATEMENTS } from './src/d1-allowlist.js';

const SECRETS = {
  INGEST_TOKEN: 'ingest-secret',
  D1_BRIDGE_TOKEN: 'd1-bridge-secret',
  MEDIA_UPLOAD_TOKEN: 'media-upload-secret',
  TTS_BRIDGE_TOKEN: 'tts-bridge-secret',
};

const ALLOWED = [...ALLOWED_D1_STATEMENTS].find((sql) => sql.includes('INSERT INTO artifact_exclusions'));
const json = (body) => JSON.stringify(body);

const ROUTES = [
  { method: 'GET', path: '/health', secret: 'INGEST_TOKEN', status: 202, forwarded: true },
  { method: 'POST', path: '/api/ingest/process', secret: 'INGEST_TOKEN', body: json({ unit_ids: [] }), status: 202, forwarded: true },
  { method: 'POST', path: '/api/ingest/handoff', secret: 'INGEST_TOKEN', body: json({}), status: 202, forwarded: true },
  { method: 'GET', path: '/settings-status', secret: 'INGEST_TOKEN', status: 200 },
  { method: 'POST', path: '/internal/d1', secret: 'D1_BRIDGE_TOKEN', body: json({ statements: [{ sql: ALLOWED, params: ['u', 1, 'r'] }] }), status: 200 },
  { method: 'PUT', path: '/internal/media?key=videos%2Fabc-123%2F1%2Fshort.mp4', secret: 'MEDIA_UPLOAD_TOKEN', body: 'abc', status: 200 },
  { method: 'DELETE', path: '/internal/media?key=videos%2Fabc-123%2F1%2Fshort.mp4', secret: 'MEDIA_UPLOAD_TOKEN', status: 200 },
  { method: 'POST', path: '/internal/tts', secret: 'TTS_BRIDGE_TOKEN', body: json({ text: 'hello' }), status: 200 },
];

test('each Worker route accepts only the secret for its own bridge', { timeout: 20000 }, async (t) => {
  const processor = {
    async useSettings() {},
    async settingsStatus() { return { container: 'stopped', running: false }; },
    reached: [],
    async fetch(request) { this.reached.push(new URL(request.url).pathname); return Response.json({ accepted: true }, { status: 202 }); },
  };
  t.mock.module('@cloudflare/containers', { namedExports: { Container: class {}, getContainer: () => processor } });
  const { default: worker } = await import('./src/index.js');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: timingSafeEqual });

  const env = {
    ...SECRETS,
    PROCESSOR: {},
    DB: { prepare(sql) { return { bind(...params) { return { sql, params }; } }; }, async batch(statements) { return statements.map(() => ({ success: true, results: [], meta: { changes: 0 } })); } },
    MEDIA: { async put() {}, async delete() {}, async head() { return { size: 3 } } },
    AI: { async run() { return new Uint8Array([1, 2, 3, 4]).buffer; } },
  };
  const send = (route, authorization) => {
    const body = route.method === 'GET' ? undefined : route.body ?? 'abc';
    const headers = { 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(body ?? '').length), ...(authorization === undefined ? {} : { authorization: `Bearer ${authorization}` }) };
    return worker.fetch(new Request(`https://processor${route.path}`, { method: route.method, headers, body }), env, { waitUntil() {} });
  };

  for (const route of ROUTES) {
    const own = await send(route, env[route.secret]);
    assert.equal(own.status, route.status, `${route.method} ${route.path} accepts its own secret`);
    const pathname = new URL(route.path, 'https://processor').pathname;
    assert.deepEqual(processor.reached.splice(0), route.forwarded ? [pathname] : [], `${route.method} ${route.path} reaches the processor`);
    for (const other of Object.keys(SECRETS).filter((name) => name !== route.secret)) {
      const wrong = await send(route, env[other]);
      assert.equal(wrong.status, 401, `${route.method} ${route.path} refuses ${other}`);
    }
    assert.equal((await send(route, undefined)).status, 401, `${route.method} ${route.path} refuses a request with no token`);
  }
});

test('the old shared token no longer opens the D1 or media bridges once they have their own secrets', { timeout: 20000 }, async (t) => {
  t.mock.module('@cloudflare/containers', { namedExports: { Container: class {}, getContainer: () => ({}) } });
  const { default: worker } = await import('./src/index.js');
  const env = { ...SECRETS, DB: {}, MEDIA: {} };
  const oldShared = SECRETS.INGEST_TOKEN;
  const d1 = new Request('https://processor/internal/d1', { method: 'POST', headers: { authorization: `Bearer ${oldShared}`, 'content-type': 'application/json' }, body: json({ statements: [] }) });
  const media = new Request('https://processor/internal/media?key=videos%2Fa%2F1%2Fshort.mp4', { method: 'PUT', headers: { authorization: `Bearer ${oldShared}` }, body: 'abc' });
  assert.equal((await worker.fetch(d1, env, { waitUntil() {} })).status, 401);
  assert.equal((await worker.fetch(media, env, { waitUntil() {} })).status, 401);
});
