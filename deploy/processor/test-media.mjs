import test from 'node:test';
import assert from 'node:assert/strict';
import { media } from './src/media.js';

test('processor R2 bridge stores a valid key and rejects bad keys and sizes', async () => {
  const stored = new Map();
  const env = { MEDIA: {
    async put(key, body, opts) { stored.set(key, { bytes: new Uint8Array(await new Response(body).arrayBuffer()), type: opts.httpMetadata.contentType }); },
    async head(key) { return stored.has(key) ? { size: stored.get(key).bytes.length } : null; },
  } };
  const put = (key, body = 'abc', headers = {}) => new Request(`http://processor/internal/media?key=${encodeURIComponent(key)}`, { method: 'PUT', body, headers: { 'content-type': 'video/mp4', 'content-length': String(body.length), ...headers } });
  const ok = await media(put('videos/abc-123/1/short.mp4'), env);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { size: 3 });
  assert.equal(stored.get('videos/abc-123/1/short.mp4').type, 'video/mp4');
  for (const key of ['videos/abc-123/1/render-123/short.mp4', 'captions/abc-123/1/render-123/short.vtt', 'audio/abc-123/1/render-123/narration.m4a']) {
    const result = await media(put(key,'new'),env);
    assert.equal(result.status,200);
    assert.deepEqual(await result.json(),{size:3});
    assert.equal(new TextDecoder().decode(stored.get(key).bytes),'new');
  }
  assert.equal(new TextDecoder().decode(stored.get('videos/abc-123/1/short.mp4').bytes),'abc','replacement keys preserve old bytes');
  for (const key of ['', '../videos/x/1/a.mp4', 'videos/x/1/../../a', 'other/x/1/a.mp4', 'videos/x/a.mp4', 'videos/x/1/a/b/c.mp4'])
    assert.equal((await media(put(key), env)).status, 400);
  assert.equal((await media(put('videos/x/1/a.mp4', ''), env)).status, 413);
  assert.equal((await media(put('videos/x/1/a.mp4'), {})).status, 503);
  assert.equal((await media(put('videos/x/1/a.mp4'), { MEDIA: { put() { throw new Error('offline'); } } })).status, 500);
});
