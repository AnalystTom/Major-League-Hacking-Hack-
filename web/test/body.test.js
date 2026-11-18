import test from 'node:test';
import assert from 'node:assert/strict';
import { readBodyText } from '../src/body.js';

const chunked = (chunks, onPull = () => {}) => new ReadableStream({
  pull(controller) {
    onPull();
    const next = chunks.shift();
    if (next === undefined) controller.close();
    else controller.enqueue(new TextEncoder().encode(next));
  },
});

test('reads a body within the limit, across chunks', async () => {
  const request = new Request('http://localhost/x', { method: 'POST', body: chunked(['{"a":', '1}']), duplex: 'half' });
  assert.equal(await readBodyText(request, 100), '{"a":1}');
});

test('an empty body reads as an empty string', async () => {
  assert.equal(await readBodyText(new Request('http://localhost/x', { method: 'POST' }), 100), '');
});

test('a declared Content-Length over the limit is refused without reading the body', async () => {
  const request = { headers: new Headers({ 'content-length': '1000' }), body: chunked(['{}']) };
  assert.equal(await readBodyText(request, 100), null);
  assert.equal(request.body.locked, false);
});

test('a streamed body with no Content-Length stops once it passes the limit', async () => {
  let pulled = 0;
  const request = { headers: new Headers(), body: chunked(Array(10).fill('0123456789'), () => { pulled += 1; }) };
  assert.equal(await readBodyText(request, 25), null);
  assert.ok(pulled <= 3, `read ${pulled} chunks past a 25-byte limit`);
});

test('the limit counts bytes, not characters', async () => {
  const request = new Request('http://localhost/x', { method: 'POST', body: 'é'.repeat(10), duplex: 'half' });
  assert.equal(await readBodyText(request, 15), null);
});
