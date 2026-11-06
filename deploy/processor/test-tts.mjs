import test from 'node:test';
import assert from 'node:assert/strict';
import { tts, FALLBACK_MODEL } from './src/tts.js';

test('processor narration bridge runs Aura-2 for valid text and rejects the rest', async () => {
  const calls = [];
  const env = { AI: { async run(model, input) { calls.push([model, input]); return new Uint8Array([82, 73, 70, 70]); } } };
  const post = (body) => new Request('http://processor/internal/tts', { method: 'POST', body: JSON.stringify(body) });
  const ok = await tts(post({ text: 'Run code review first.' }), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'audio/wav');
  assert.equal(new TextDecoder().decode(await ok.arrayBuffer()), 'RIFF');
  assert.equal(calls[0][0], FALLBACK_MODEL);
  assert.deepEqual(calls[0][1], { text: 'Run code review first.', speaker: 'athena', encoding: 'linear16', container: 'wav', sample_rate: 24000 });
  for (const body of [{}, { text: '' }, { text: 'x'.repeat(2001) }]) assert.equal((await tts(post(body), env)).status, 400);
  assert.equal((await tts(post({ text: 'hi' }), {})).status, 503);
  assert.equal((await tts(post({ text: 'hi' }), { AI: { run() { throw new Error('down'); } } })).status, 502);
});
