import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import app from '../src/index.js';
import { CONTENT_SECURITY_POLICY, withSecurityHeaders } from '../src/security-headers.js';
import { serveMedia } from '../src/media.js';
import { xRoute } from '../src/x-oauth.js';

const publicDirectory = new URL('../public/', import.meta.url);
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

test('a response that already sets a header keeps its own value', async () => {
  const redirect = withSecurityHeaders(new Response(null, { status: 303, headers: { 'referrer-policy': 'no-referrer', location: '/app' } }));
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('location'), '/app');
  assert.equal(redirect.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(redirect.headers.get('x-frame-options'), 'DENY');
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

test('every public page loads only same-origin scripts and no inline script, style or style attribute', () => {
  const pages = readdirSync(publicDirectory).filter((file) => file.endsWith('.html'));
  assert.ok(pages.length >= 5);
  for (const file of pages) {
    const html = readFileSync(new URL(file, publicDirectory), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, `${file} has an inline script`);
    assert.doesNotMatch(html, /<script[^>]*\ssrc="https?:/, `${file} loads a script from another origin`);
    assert.doesNotMatch(html, /<style[\s>]/, `${file} has an inline stylesheet`);
    assert.doesNotMatch(html, /\sstyle="/, `${file} has a style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+="/, `${file} has an inline event handler`);
  }
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
