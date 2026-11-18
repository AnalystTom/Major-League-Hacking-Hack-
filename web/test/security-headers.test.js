import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.js';
import { CONTENT_SECURITY_POLICY } from '../src/security-headers.js';
import { serveMedia } from '../src/media.js';
import { xRoute } from '../src/x-oauth.js';

const allow = { async limit() { return { success: true }; } };
const assets = { ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) } };
const streamed = (chunks) => new ReadableStream({
  pull(controller) {
    const next = chunks.shift();
    if (next === undefined) controller.close();
    else controller.enqueue(new TextEncoder().encode(next));
  },
});
const directives = Object.fromEntries(CONTENT_SECURITY_POLICY.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

test('static assets carry the page security headers', async () => {
  const response = await app.fetch(new Request('http://localhost/start'), assets, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
});

test('API and error responses carry the headers too', async () => {
  const response = await app.fetch(new Request('http://localhost/api/waitlist'), { WAITLIST_LIMITER: allow }, {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('content-security-policy'), CONTENT_SECURITY_POLICY);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('the policy blocks inline code, foreign scripts and framing, and admits the origins the pages use', () => {
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-(inline|eval)/);
  assert.deepEqual(directives['script-src'], ["'self'"]);
  assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['frame-src'], ['https://www.loom.com']);
  assert.deepEqual(directives['style-src'], ["'self'", 'https://fonts.googleapis.com']);
  assert.deepEqual(directives['font-src'], ["'self'", 'https://fonts.gstatic.com']);
});

test('media is served with the type its extension names, never a stored type', async () => {
  const object = {
    size: 4,
    httpEtag: '"etag"',
    writeHttpMetadata(headers) { headers.set('content-type', 'text/html'); },
    body: new Blob(['data']).stream(),
  };
  const env = { MEDIA: { head: async () => object, get: async () => object } };
  const response = await serveMedia(new Request('http://localhost/media/videos/a/short.mp4'), env, 'videos/a/short.mp4');
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  const unknown = await serveMedia(new Request('http://localhost/media/videos/a/data.bin', { method: 'HEAD' }), env, 'videos/a/data.bin');
  assert.equal(unknown.headers.get('content-type'), 'application/octet-stream');
});

test('the waitlist refuses an oversize body by Content-Length before reading it', async () => {
  const response = await app.fetch(new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@example.test', note: 'x'.repeat(40_000) }),
  }), { WAITLIST_LIMITER: allow, DB: { prepare() { throw new Error('the body must not reach the database'); } } }, {});
  assert.equal(response.status, 413);
});

test('the waitlist refuses a streamed oversize body with no Content-Length', async () => {
  const response = await app.fetch(new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: streamed(Array(40).fill('x'.repeat(1000))),
    duplex: 'half',
  }), { WAITLIST_LIMITER: allow, DB: { prepare() { throw new Error('the body must not reach the database'); } } }, {});
  assert.equal(response.status, 413);
});

test('sign-in refuses an oversize body before it is parsed', async () => {
  const env = { AUTH_LIMITER: allow, DB: { prepare() { throw new Error('the body must not reach the database'); } } };
  const body = JSON.stringify({ email: 'a@example.test', password: 'x'.repeat(39_000) });
  const response = await app.fetch(new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(body).length) },
    body,
  }), env, {});
  assert.equal(response.status, 413);
  assert.match(await response.text(), /too large/);
});

test('the X bookmark import refuses an oversize body before parsing it', async () => {
  const env = {
    IMPORT_LIMITER: allow,
    X_CLIENT_ID: 'fixture-client',
    X_CLIENT_SECRET: 'fixture-secret',
    X_CALLBACK_URL: 'https://resurface.example.test/api/auth/x/callback',
    X_READS_ENABLED: 'true',
  };
  const request = new Request('https://resurface.example.test/api/x/bookmarks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh: true, padding: 'x'.repeat(5000) }),
  });
  const response = await xRoute(request, env, null, { id: 'user-1' });
  assert.equal(response.status, 413);
});
