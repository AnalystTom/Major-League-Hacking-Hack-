import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from '../../../web/test/migrations.js';
import { D1Database, decodeRow, type Database, type Statement } from '../../src/db.js';
import { database as processorBridge } from '../../../deploy/processor/src/database.js';

function run(sqlite: DatabaseSync, s: Statement) {
  const query = sqlite.prepare(s.sql);
  const params = Object.fromEntries((s.params ?? []).flatMap((v,i) => s.sql.match(new RegExp('\\?' + (i+1) + '(?![0-9])')) ? [[String(i+1),v]] : []));
  const rows = query.all(params as Record<string, string | number | null>);
  return { rows, changes: Number((sqlite.prepare('SELECT changes() AS n').get() as { n: number }).n) };
}

function inTransaction<T>(sqlite: DatabaseSync, work: () => T): T {
  sqlite.exec('BEGIN');
  try { const result=work();sqlite.exec('COMMIT');return result; }
  catch(e) { sqlite.exec('ROLLBACK');throw e; }
}

export function testDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  applyMigrations(sqlite);
  const execute = (s: Statement) => {
    const { rows, changes } = run(sqlite, s);
    return { rows: rows.map((r) => decodeRow(r)), rowCount: changes };
  };
  const db: Database = {
    async query(sql,params=[]) { return execute({ sql,params }); },
    async batch(statements) { return inTransaction(sqlite, () => statements.map(execute)); },
  };
  return { db, sqlite };
}

export function bridgedDatabase() {
  const { db: direct, sqlite } = testDatabase();
  const DB = {
    prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({ sql, params }) }),
    async batch(statements: Statement[]) {
      return inTransaction(sqlite, () => statements.map((s) => {
        const { rows, changes } = run(sqlite, s);
        return { success: true, results: rows, meta: { changes } };
      }));
    },
  };
  const bridge = (async (url: string, init: RequestInit) => processorBridge(new Request(url, init), { DB })) as unknown as typeof fetch;
  return { db: new D1Database('http://localhost/internal/d1', 'test-token', bridge), direct, sqlite };
}
