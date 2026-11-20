import test from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { logFailure } from './src/log.js';

test('a parse error logs its name only so a token fragment in the body never reaches the log', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  logFailure('token renewal failed', new SyntaxError('Unexpected token in JSON at position 5: {"refresh_token":"fixture-leak-token"'));
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments), [['token renewal failed', 'SyntaxError']]);
  assert.ok(!JSON.stringify(logged.mock.calls).includes('fixture-leak-token'));
});

test('a processor container that fails to start logs one line and still answers 502', async (t) => {
  const processor = {
    async useSettings() {},
    async fetch() { throw new Error('container failed to start: D1_BRIDGE_TOKEN missing'); },
  };
  t.mock.module('@cloudflare/containers', { namedExports: { Container: class {}, getContainer: () => processor } });
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: timingSafeEqual });
  const logged = t.mock.method(console, 'error', () => {});
  const { default: worker } = await import('./src/index.js');

  const response = await worker.fetch(new Request('https://processor/health', { headers: { authorization: 'Bearer ingest-secret' } }), { INGEST_TOKEN: 'ingest-secret', PROCESSOR: {} }, { waitUntil() {} });

  assert.equal(response.status, 502);
  assert.equal(await response.text(), "The processor didn't start.");
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments), [['processor container start failed', 'container failed to start: D1_BRIDGE_TOKEN missing']]);
  assert.ok(!JSON.stringify(logged.mock.calls).includes('ingest-secret'));
});
