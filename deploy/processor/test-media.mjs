import test from 'node:test';
import assert from 'node:assert/strict';
import { media } from './src/media.js';

const stored = () => new Map();

function fakeBucket(objects) {
  return {
    async put(key, body, opts) {
      objects.set(key, { bytes: new Uint8Array(await new Response(body).arrayBuffer()), type: opts.httpMetadata.contentType });
    },
    async head(key) { return objects.has(key) ? { size: objects.get(key).bytes.length } : null; },
  };
}

const put = (key, body = 'abc', headers = {}) => new Request(`http://processor/internal/media?key=${encodeURIComponent(key)}`, {
  method: 'PUT', body, headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length), ...headers },
});

test('processor R2 bridge stores a valid key with the content type its extension names', async () => {
  const objects = stored();
  const env = { MEDIA: fakeBucket(objects) };
  const ok = await media(put('videos/abc-123/1/short.mp4', 'abc', { 'content-type': 'text/html' }), env);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { size: 3 });
  assert.equal(objects.get('videos/abc-123/1/short.mp4').type, 'video/mp4', 'the caller-supplied header is ignored');
  assert.equal((await media(put('captions/abc-123/1/short.vtt', 'WEBVTT'), env)).status, 200);
  assert.equal(objects.get('captions/abc-123/1/short.vtt').type, 'text/vtt; charset=utf-8');
  assert.equal((await media(put('audio/abc-123/1/narration.m4a', 'm4a'), env)).status, 200);
  assert.equal(objects.get('audio/abc-123/1/narration.m4a').type, 'audio/mp4');
  for (const key of ['videos/abc-123/1/render-123/short.mp4', 'captions/abc-123/1/render-123/short.vtt', 'audio/abc-123/1/render-123/narration.m4a']) {
    const result = await media(put(key, 'new'), env);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { size: 3 });
    assert.equal(new TextDecoder().decode(objects.get(key).bytes), 'new');
  }
  assert.equal(new TextDecoder().decode(objects.get('videos/abc-123/1/short.mp4').bytes), 'abc', 'replacement keys preserve old bytes');
});

test('processor R2 bridge refuses an extension that is not on the allow-list', async () => {
  const objects = stored();
  const env = { MEDIA: fakeBucket(objects) };
  for (const key of ['videos/abc-123/1/short.html', 'videos/abc-123/1/short.svg', 'captions/abc-123/1/short.js', 'videos/abc-123/1/short']) {
    assert.equal((await media(put(key, 'x', { 'content-type': 'video/mp4' }), env)).status, 415, key);
  }
  assert.equal(objects.size, 0);
});

test('processor R2 bridge rejects bad keys and sizes', async () => {
  const env = { MEDIA: fakeBucket(stored()) };
  for (const key of ['', '../videos/x/1/a.mp4', 'videos/x/1/../../a', 'other/x/1/a.mp4', 'videos/x/a.mp4', 'videos/x/1/a/b/c.mp4'])
    assert.equal((await media(put(key), env)).status, 400);
  assert.equal((await media(put('videos/x/1/a.mp4', ''), env)).status, 413);
  assert.equal((await media(put('videos/x/1/a.mp4'), {})).status, 503);
  assert.equal((await media(put('videos/x/1/a.mp4'), { MEDIA: { put() { throw new Error('offline'); } } })).status, 500);
});

test('processor R2 bridge deletes a stored key and reports a failed delete', async () => {
  const stored = new Map([['audio/abc-123/1/render-123/narration.m4a', 'x']]);
  const env = { MEDIA: {
    async delete(key) { if (key === 'videos/x/1/fail.mp4') throw new Error('offline'); stored.delete(key); },
  } };
  const del = (key) => new Request(`http://processor/internal/media?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
  const removed = await media(del('audio/abc-123/1/render-123/narration.m4a'), env);
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { deleted: true });
  assert.equal(stored.has('audio/abc-123/1/render-123/narration.m4a'), false);
  assert.equal((await media(del('../videos/x/1/a.mp4'), env)).status, 400);
  assert.equal((await media(del('videos/x/1/fail.mp4'), env)).status, 500);
  assert.equal((await media(del('videos/x/1/a.mp4'), {})).status, 503);
});

test('processor R2 bridge logs a failed put and a failed delete once each and answers 500', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const failing = { async put() { throw new Error('R2 offline'); }, async delete() { throw new Error('R2 offline'); } };
  const del = new Request(`http://processor/internal/media?key=${encodeURIComponent('videos/x/1/a.mp4')}`, { method: 'DELETE' });
  assert.equal((await media(put('videos/x/1/a.mp4'), { MEDIA: failing })).status, 500);
  assert.equal((await media(del, { MEDIA: failing })).status, 500);
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments), [['R2 put failed', 'R2 offline'], ['R2 delete failed', 'R2 offline']]);
});
