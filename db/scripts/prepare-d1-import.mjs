// Accepts a private JSON snapshot {table: rows} exported from one read-only PostgreSQL transaction.
// Writes SQLite INSERTs without changing IDs, password/session hashes, JSON or media references.
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const TABLES=['project_contexts','digestion_prompts','ingested_units','artifacts','artifact_exclusions',
  'video_results','skill_results','action_items','handoffs','users','sessions','user_imports','processing_starts','agent_briefs'];
export function normalize(row) {
  return Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,
    value===null ? null : typeof value==='boolean' ? Number(value) : typeof value==='object' ? JSON.stringify(value)
    : /(?:_at|expires_at|deferred_until)$/.test(key) && typeof value==='string' ? new Date(value).toISOString() : value]));
}
export const checksum=(rows)=>createHash('sha256').update(JSON.stringify(rows.map(normalize).map(r=>JSON.stringify(r)).sort())).digest('hex');
export function prepare(source) {
  const unknown=Object.keys(source).filter(t=>!TABLES.includes(t));
  if(unknown.length || TABLES.some(t=>!Array.isArray(source[t]))) throw new Error(`Snapshot tables do not match application schema: ${unknown.join(',')}`);
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(readFileSync(new URL('../../web/migrations/0002_application.sql',import.meta.url),'utf8'));
    db.exec(readFileSync(new URL('../../web/migrations/0003_video_duration.sql',import.meta.url),'utf8'));
    const statements=[],report={};
    for(const table of TABLES) {
      const columns=new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(c=>c.name));
      for(const row of source[table]) {
        const normalized=normalize(row),keys=Object.keys(normalized);
        if(keys.some(k=>!columns.has(k))) throw new Error(`${table} has an unmapped source column`);
        const statement={sql:`INSERT INTO "${table}" (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,params:keys.map(k=>normalized[k])};
        if(Buffer.byteLength(statement.sql)>100_000 || keys.length>100) throw new Error(`${table}: row exceeds D1 statement limits`);
        if(keys.map(k=>normalized[k]).reduce((n,v)=>n+Buffer.byteLength(String(v??'')),0)>2_000_000) throw new Error(`${table}: row exceeds D1 row size`);
        db.prepare(statement.sql).run(...statement.params);statements.push(statement);
      }
      const rows=db.prepare(`SELECT * FROM "${table}"`).all().map(({batch_token,...r})=>table==='processing_starts' ? r : { ...r,...(batch_token===undefined?{}:{batch_token}) });
      // Defaults are permitted only for new D1 coordination fields; every source column must be preserved.
      const sourceKeys=Object.keys(source[table][0]??{});
      const actual=rows.map(row=>Object.fromEntries(sourceKeys.map(key=>[key,row[key]])));
      if(checksum(actual)!==checksum(source[table])) throw new Error(`${table}: imported values differ from source`);
      report[table]={rows:rows.length,sha256:checksum(source[table])};
    }
    if(db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key validation failed');
    return {statements,report};
  }finally{db.close();}
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  const [sourcePath,out]=process.argv.slice(2);
  if(!sourcePath||!out) throw new Error('usage: node db/scripts/prepare-d1-import.mjs <private-snapshot.json> <private-output.json>');
  const {statements,report}=prepare(JSON.parse(readFileSync(sourcePath,'utf8')));
  writeFileSync(out,JSON.stringify(statements),{mode:0o600});writeFileSync(out+'.report.json',JSON.stringify(report,null,2),{mode:0o600});
  console.log('Validated all source rows, constraints, checksums and foreign keys. Bound D1 import written.');
}
