import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import app from '../src/index.js';
import { connect } from '../src/db.js';
import { readFeed } from '../src/feed.js';
import { readSkills } from '../src/skills.js';
import { readUnits } from '../src/imports.js';
import { createHandoff, readHandoff } from '../src/handoffs.js';

function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../migrations/0002_application.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0003_video_duration.sql',import.meta.url),'utf8'));
  const env={DB:{prepare(sql){return {bind(...params){return {async all(){return {results:sqlite.prepare(sql).all(...params)}}}}}}}};
  return {sqlite,env,sql:connect(env)};
}

test('D1 account sessions, import reuse and isolation run against the full application schema',async()=>{
  const {sqlite,env,sql}=database();
  const call=(path,body,cookie)=>app.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{});
  try {
    assert.deepEqual(await (await call('/api/me')).json(),{user:null});
    assert.equal((await call('/api/imports')).status,401);
    assert.deepEqual(await (await call('/api/feed')).json(),{items:[]});
    const signup=await call('/api/auth/signup',{email:'first@example.com',password:'correct horse battery'});
    assert.equal(signup.status,201);
    const first=await signup.json(),cookie=signup.headers.get('set-cookie').split(';')[0];
    assert.equal(first.imports,0);
    assert.equal((await call('/api/auth/signup',{email:'first@example.com',password:'correct horse battery'})).status,409);
    const imported=await call('/api/imports',{links:['https://youtu.be/VQy50fuxI34']},cookie);
    assert.equal(imported.status,201);
    const result=await imported.json();
    assert.equal(result.units[0].stage,'queued');
    assert.equal(result.processor,'not_configured');
    const duplicate=await (await call('/api/imports',{links:['https://youtu.be/VQy50fuxI34']},cookie)).json();
    assert.equal(duplicate.units[0].id,result.units[0].id);
    assert.equal((await (await call('/api/me',null,cookie)).json()).imports,1);
    const second=await call('/api/auth/signup',{email:'second@example.com',password:'correct horse battery'});
    const cookie2=second.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await (await call('/api/imports',null,cookie2)).json(),{units:[]});
    assert.deepEqual(await (await call('/api/feed?scope=mine',null,cookie2)).json(),{items:[]});
    assert.deepEqual(await (await call('/api/skills',null,cookie2)).json(),{skills:[]});
    await call('/api/auth/logout',{},cookie);
    assert.deepEqual(await (await call('/api/me',null,cookie)).json(),{user:null});
    assert.equal((await call('/api/auth/login',{email:'first@example.com',password:'wrong password'})).status,401);
    const login=await call('/api/auth/login',{email:'first@example.com',password:'correct horse battery'});
    assert.equal(login.status,200);
    assert.equal((await login.json()).imports,1);
    await sql`UPDATE sessions SET expires_at='2000-01-01T00:00:00Z'`;
    assert.deepEqual(await (await call('/api/me',null,login.headers.get('set-cookie').split(';')[0])).json(),{user:null});
  }finally{sqlite.close();}
});

test('D1 JSON output reads preserve source order, real errors, private digests and handoff ownership',async()=>{
  const {sqlite,sql}=database();
  try {
    const [user]=await sql`INSERT INTO users(email,password_hash) VALUES('a@example.com','hash') RETURNING id`;
    const [other]=await sql`INSERT INTO users(email,password_hash) VALUES('b@example.com','hash') RETURNING id`;
    const [u1]=await sql`INSERT INTO ingested_units(submitted_url,source_url,title) VALUES('https://youtu.be/VQy50fuxI34','https://www.youtube.com/watch?v=VQy50fuxI34','Source one') RETURNING id`;
    const [u2]=await sql`INSERT INTO ingested_units(submitted_url,source_url,title) VALUES('https://youtu.be/V-EDrhIhHzQ','https://www.youtube.com/watch?v=V-EDrhIhHzQ','Source two') RETURNING id`;
    const sources=[u2.id,u1.id];
    const [a]=await sql`INSERT INTO artifacts(name,source_url,source_ids,sources,processed_text,ingestion_status)
      VALUES('Artifact','https://www.youtube.com/watch?v=VQy50fuxI34',${JSON.stringify(sources)},'[]','text','ready') RETURNING id`;
    const [s]=await sql`INSERT INTO skill_results(artifact_id,artifact_version,status,skill_markdown)
      VALUES(${a.id},1,'ready','---\nname: check\ndescription: "Check"\n---\nbody') RETURNING id`;
    await sql`INSERT INTO action_items(skill_result_id,task,prerequisites,steps,completion_check)
      VALUES(${s.id},'Inspect','["Repo"]','["Read"]','Checked')`;
    await sql`INSERT INTO video_results(artifact_id,artifact_version,status,media_ref,caption_ref,narration_ref,duration_seconds,feed_order)
      VALUES(${a.id},1,'ready','r2:videos/a/1/short.mp4','r2:captions/a/1/short.vtt','r2:audio/a/1/narration.m4a',30.5,1)`;
    assert.equal((await readFeed(sql))[0].video.duration_seconds,30.5);
    assert.equal((await readFeed(sql,[u1.id])).length,0);
    assert.equal((await readSkills(sql,[u1.id])).length,0);
    const skill=(await readSkills(sql,[u1.id,u2.id]))[0];
    assert.deepEqual(skill.action_items[0].steps,['Read']);
    assert.deepEqual(skill.videos.map(v=>v.id),sources);
    const units=await readUnits(sql,[u2.id,u1.id]);
    assert.deepEqual(units.map(u=>u.id),sources);
    await sql`UPDATE ingested_units SET status='ready',transcript='{}'`;
    assert.equal((await readUnits(sql,[u1.id],[u1.id]))[0].stage,'digesting');
    assert.equal((await readUnits(sql,[u1.id],sources))[0].stage,'ready');
    assert.equal((await createHandoff(sql,{},user,[u1.id],[s.id])).status,400);
    const brief=await createHandoff(sql,{},user,sources,[s.id]);
    assert.equal(brief.brief.status,'pending');
    assert.deepEqual(brief.brief.skill_ids,[s.id]);
    const again=await createHandoff(sql,{},user,sources,[s.id]);
    assert.equal(brief.brief.id,again.brief.id);
    assert.equal(await readHandoff(sql,other,brief.brief.id),null);
    const prompts={codex:{review:'Review the actual skill'}};
    await sql`UPDATE agent_briefs SET status='ready',prompts=${JSON.stringify(prompts)},brief='{"title":"Brief"}' WHERE id=${brief.brief.id}`;
    assert.deepEqual((await readHandoff(sql,user)).prompts,prompts);
    await sql`UPDATE agent_briefs SET status='failed',error='provider error' WHERE id=${brief.brief.id}`;
    assert.equal((await readHandoff(sql,user)).error,'provider error');
    assert.equal((await createHandoff(sql,{},user,sources,[s.id])).brief.status,'pending');
  }finally{sqlite.close();}
});

test('processor outages do not block saved progress, ready shorts or new imports',async()=>{
  const {sqlite,env,sql}=database();
  const call=(path,body,cookie)=>app.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{});
  try {
    const signup=await call('/api/auth/signup',{email:'outage@example.com',password:'correct horse battery'});
    assert.equal(signup.status,201);
    const cookie=signup.headers.get('set-cookie').split(';')[0];
    const url='https://x.com/pfernan95dev/status/2111437891322745223';
    const imported=await (await call('/api/imports',{links:[url]},cookie)).json();
    const unit=imported.units[0];
    await sql`UPDATE ingested_units SET status='ready',transcript='{}' WHERE id=${unit.id}`;
    const [artifact]=await sql`INSERT INTO artifacts(name,source_url,source_ids,processed_text,ingestion_status)
      VALUES('Growing an audience',${url},${JSON.stringify([unit.id])},'Source-grounded narration','ready') RETURNING id`;
    await sql`INSERT INTO video_results(artifact_id,artifact_version,status,media_ref,caption_ref,narration_ref,duration_seconds)
      VALUES(${artifact.id},1,'ready','r2:videos/outage/1/short.mp4','r2:captions/outage/1/short.vtt','r2:audio/outage/1/narration.m4a',30)`;
    env.PROCESSOR_URL='https://processor/api/ingest/process';
    env.PROCESSOR_TOKEN='test-token';
    const videos=['VQy50fuxI34','V-EDrhIhHzQ','dQw4w9WgXcQ'];
    for (const [i,status] of [401,502,null].entries()) {
      const calls=[];
      env.PROCESSOR={async fetch(url,init){
        calls.push({url:String(url),method:init?.method});
        if(status===null)throw new DOMException('Timed out','TimeoutError');
        return new Response(null,{status});
      }};
      const progress=await call('/api/imports',null,cookie);
      assert.equal(progress.status,200);
      const saved=(await progress.json()).units.find(u=>u.id===unit.id);
      assert.deepEqual([saved.stage,saved.settled,saved.error],['ready',true,null]);
      const feed=await call('/api/feed?scope=mine',null,cookie);
      assert.equal(feed.status,200);
      assert.deepEqual((await feed.json()).items.map(item=>item.id),[artifact.id]);
      assert.equal(calls.length,0);

      const response=await call('/api/imports',{links:[`https://youtu.be/${videos[i]}`]},cookie);
      assert.equal(response.status,201);
      const queued=await response.json();
      assert.equal(queued.processor,'unavailable');
      assert.deepEqual([queued.units[0].stage,queued.units[0].settled],['queued',false]);
      assert.deepEqual(calls,[{url:env.PROCESSOR_URL,method:'POST'}]);
      assert.equal((await sql`SELECT count(*) AS n FROM user_imports WHERE unit_id=${queued.units[0].id}`)[0].n,1);
    }
  }finally{sqlite.close();}
});
