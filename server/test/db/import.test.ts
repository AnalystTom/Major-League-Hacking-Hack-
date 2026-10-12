import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers.js';

const { prepare,TABLES }=await import('../../../db/scripts/prepare-d1-import.mjs');
test('D1 import preserves large briefs, private hashes, IDs and foreign keys, and rejects unmapped data',()=>{
 const {sqlite}=testDatabase();
 try {
  sqlite.exec("INSERT INTO users(id,email,password_hash,created_at) VALUES('user','saved@example.com','private-hash','2026-10-11T12:00:00Z')");
  sqlite.exec("INSERT INTO ingested_units(id,submitted_url,source_url) VALUES('unit','source','source')");
  const brief='x'.repeat(110000);
  sqlite.prepare("INSERT INTO agent_briefs(id,user_id,skill_result_ids,input_key,status,prompts) VALUES('brief','user','[\"skill\"]','key','ready',?)").run(JSON.stringify({codex:{review:brief}}));
  const source=Object.fromEntries(TABLES.map((table:string)=>[table,sqlite.prepare(`SELECT * FROM ${table}`).all().map(row=>{
   const {batch_token,...kept}=row;return table==='processing_starts'?kept:row;
  })]));
  const prepared=prepare(source);
  assert.equal(prepared.report.users.rows,1);
  assert.ok(prepared.statements.every((s:any)=>s.sql.length<100000));
  assert.ok(prepared.statements.some((s:any)=>s.params.includes('private-hash')));
  assert.ok(prepared.statements.some((s:any)=>s.params.some((v:any)=>typeof v==='string'&&v.includes(brief))));
  assert.throws(()=>prepare({...source,unknown:[]}),/do not match/);
  assert.throws(()=>prepare({...source,users:[{...source.users[0],unknown:'unmapped'}]}),/unmapped/);
  assert.throws(()=>prepare({...source,sessions:[{token_hash:'hash',user_id:'missing',created_at:new Date().toISOString(),expires_at:new Date().toISOString()}]}),/FOREIGN KEY/);
 }finally{sqlite.close();}
});
