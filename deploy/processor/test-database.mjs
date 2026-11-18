import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './src/database.js';
import { ALLOWED_D1_STATEMENTS } from './src/d1-allowlist.js';

const ALLOWED = 'INSERT INTO artifact_exclusions(unit_id,digestion_prompt_id,reason) VALUES(?1,?2,?3)';
const request = (body) => new Request('http://processor/internal/d1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function fakeDatabase() {
  const calls = [];
  return {
    calls,
    prepare(sql) { return { bind(...params) { return { sql, params }; } }; },
    async batch(statements) {
      calls.push(statements);
      return statements.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
    },
  };
}

test('processor D1 bridge runs an allow-listed statement with bound parameters', async () => {
  assert.ok(ALLOWED_D1_STATEMENTS.has(ALLOWED));
  const DB = fakeDatabase();
  const response = await database(request({ statements: [{ sql: ALLOWED, params: ['unit', 1, 'reason'] }] }), { DB });
  assert.equal(response.status, 200);
  assert.deepEqual(DB.calls, [[{ sql: ALLOWED, params: ['unit', 1, 'reason'] }]]);
});

test('processor D1 bridge refuses any statement that is not on the allow-list', async () => {
  const DB = fakeDatabase();
  assert.equal((await database(request({ statements: [{ sql: 'SELECT password_hash FROM users', params: [] }] }), { DB })).status, 403);
  assert.equal((await database(request({ statements: [{ sql: "SELECT ?1", params: ["'; DROP TABLE users;"] }] }), { DB })).status, 403);
  assert.deepEqual(DB.calls, [], 'nothing runs when any statement is refused');
});

test('processor D1 bridge refuses a batch that mixes an allowed statement with a refused one', async () => {
  const DB = fakeDatabase();
  const batch = { statements: [{ sql: ALLOWED, params: ['u', 1, 'r'] }, { sql: 'DELETE FROM users', params: [] }] };
  assert.equal((await database(request(batch), { DB })).status, 403);
  assert.deepEqual(DB.calls, []);
});

test('processor D1 bridge validates batch shape and rejects malformed parameters', async () => {
  const DB = fakeDatabase();
  for (const body of [
    { statements: [] },
    { statements: [{ sql: ALLOWED, params: [{}] }] },
    { statements: [{ sql: ALLOWED, params: Array(101).fill(null) }] },
    { statements: [{ sql: '   ', params: [] }] },
  ]) assert.equal((await database(request(body), { DB })).status, 400);
  assert.deepEqual(DB.calls, []);
});

test('processor D1 bridge reports an unconfigured binding and a failed batch', async () => {
  assert.equal((await database(request({ statements: [{ sql: ALLOWED, params: ['u', 1, 'r'] }] }), {})).status, 503);
  const DB = { prepare() { return { bind() { return {}; } }; }, async batch() { throw new Error('offline'); } };
  assert.equal((await database(request({ statements: [{ sql: ALLOWED, params: ['u', 1, 'r'] }] }), { DB })).status, 500);
});
