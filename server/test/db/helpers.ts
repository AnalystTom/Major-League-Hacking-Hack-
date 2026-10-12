import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { decodeRow, type Database, type Statement } from '../../src/db.js';

// Real SQLite, with the exact migration Wrangler applies to D1. No skipped database tests.
export function testDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../../../web/migrations/0002_application.sql', import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../../../web/migrations/0003_video_duration.sql', import.meta.url),'utf8'));
  const execute = (s: Statement) => {
    const query = sqlite.prepare(s.sql);
    // SQLite's Node API binds ?NNN parameters by name, matching D1's positional bindings.
    const params = Object.fromEntries((s.params ?? []).flatMap((v,i) => s.sql.match(new RegExp('\\?' + (i+1) + '(?![0-9])')) ? [[String(i+1),v]] : []));
    const rows = query.all(params as Record<string, string | number | null>).map((r) => decodeRow(r));
    return { rows, rowCount: Number((sqlite.prepare('SELECT changes() AS n').get() as { n: number }).n) };
  };
  const db: Database = {
    async query(sql,params=[]) { return execute({ sql,params }); },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results=statements.map(execute);sqlite.exec('COMMIT');return results; }
      catch(e) { sqlite.exec('ROLLBACK');throw e; }
    },
  };
  return { db, sqlite };
}
