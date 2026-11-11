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
import { SKILL_PROMPT_REVISION } from '../src/skill-policy.js';

function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../migrations/0002_application.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0003_video_duration.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0005_skill_choices.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0007_video_limits.sql',import.meta.url),'utf8'));
  const env={AUTH_LIMITER:{async limit(){return {success:true}}},IMPORT_LIMITER:{async limit(){return {success:true}}},DB:{prepare(sql){return {bind(...params){return {async all(){return {results:sqlite.prepare(sql).all(...params)}}}}}}}};
  return {sqlite,env,sql:connect(env)};
}

test('D1 account sessions, import reuse and isolation run against the full application schema',async()=>{
  const {sqlite,env,sql}=database();
  const call=(path,body,cookie)=>app.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{});
  try {
    assert.deepEqual(await (await call('/api/me')).json(),{user:null});
    assert.equal((await call('/api/imports')).status,401);
    assert.equal((await call('/api/feed')).status,401);
    assert.deepEqual(await (await call('/api/feed?scope=public')).json(),{items:[]});
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

test('cached X reads from an older extractor are replaced on submit, then the current read is reused',async()=>{
  const {sqlite,env,sql}=database();
  const post=JSON.parse(readFileSync(new URL('../../server/test/ingest/fixtures/xpost-2111437891322745223.json',import.meta.url),'utf8'));
  const source=`https://x.com/i/status/${post.id_str}`;
  const call=(path,body,cookie)=>app.fetch(new Request(`http://localhost${path}`,{method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)}),env,{});
  try {
    const signup=await call('/api/auth/signup',{email:'refresh@example.com',password:'correct horse battery'});
    const cookie=signup.headers.get('set-cookie').split(';')[0];
    const staleTranscript={window:[0,0],evidence_items:[{start_seconds:0,end_seconds:0,observed_spoken_content:post.text}]};
    const [old]=await sql`INSERT INTO ingested_units(submitted_url,source_url,content_type,status,transcript,extraction_method)
      VALUES(${source},${source},'x_post','ready',${JSON.stringify(staleTranscript)},'twitterapi.io:tweets') RETURNING id`;
    const requests=[];
    env.PROCESSOR_URL='https://processor/api/ingest/process';
    env.PROCESSOR={async fetch(url,init){requests.push(JSON.parse(init.body).unit_ids);return Response.json({accepted:true});}};
    const submit=async()=>{
      const response=await call('/api/imports',{links:[`https://x.com/pfernan95dev/status/${post.id_str}`]},cookie);
      assert.equal(response.status,201);
      return response.json();
    };
    const first=await submit();
    const fresh=first.units[0];
    assert.notEqual(fresh.id,old.id);
    assert.equal(fresh.stage,'queued');
    assert.deepEqual(requests,[[fresh.id]]);
    assert.equal((await submit()).units[0].id,fresh.id,'a pending fresh read must not be queued twice');
    const transcript={...staleTranscript,evidence_items:[{...staleTranscript.evidence_items[0],observed_spoken_content:`${post.text}\n\nArticle: ${post.article.title}\n\n${post.article.preview_text}`} ]};
    await sql`UPDATE ingested_units SET status='ready',transcript=${JSON.stringify(transcript)},extraction_method='x-embed:tweet-result:v2' WHERE id=${fresh.id}`;
    assert.equal((await submit()).units[0].id,fresh.id,'a current completed extraction must be reused');
    assert.deepEqual(requests,[[fresh.id]],'reusing the current unit must not request another paid run');
    assert.equal((await sql`SELECT transcript FROM ingested_units WHERE id=${old.id}`)[0].transcript.evidence_items[0].observed_spoken_content,post.text,'the historical extraction is preserved');
  }finally{sqlite.close();}
});

test('readUnits flags exactly the units whose transcript is marked preview_only',async()=>{
  const {sqlite,sql}=database();
  try {
    const add=async(n,transcript,method)=>(await sql`INSERT INTO ingested_units(submitted_url,source_url,content_type,status,transcript,extraction_method)
      VALUES(${`https://x.com/i/status/${n}`},${`https://x.com/i/status/${n}`},'x_post','ready',${JSON.stringify(transcript)},${method}) RETURNING id`)[0].id;
    const ids=[await add(1,{overview:'X Article by A.',preview_only:true},'x-embed:tweet-result:v2'),await add(2,{overview:'X post by A.'},'x-embed:tweet-result:v2'),await add(3,{overview:'X Article by A.',preview_only:true},'twitterapi.io:tweets:v2'),await add(4,{overview:'X Article by A.'},'twitterapi.io:tweets:v2')];
    assert.deepEqual((await readUnits(sql,ids)).map((u)=>u.preview_only),[true,false,true,false]);
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
    await sql`UPDATE skill_results SET review_feedback=${JSON.stringify({prompt_revision:SKILL_PROMPT_REVISION})} WHERE id=${s.id}`;
    await sql`INSERT INTO action_items(skill_result_id,task,prerequisites,steps,completion_check)
      VALUES(${s.id},'Inspect','["Repo"]','["Read"]','Checked')`;
    await sql`INSERT INTO video_results(artifact_id,artifact_version,status,media_ref,caption_ref,narration_ref,duration_seconds,feed_order)
      VALUES(${a.id},1,'ready','r2:videos/a/1/short.mp4','r2:captions/a/1/short.vtt','r2:audio/a/1/narration.m4a',30.5,1)`;
    await sql`UPDATE video_results SET review_status='approved',review_feedback=${JSON.stringify({judge:'short-judge-v1',passed:true,captions_burned:true})}`;
    assert.equal((await readFeed(sql))[0].video.duration_seconds,30.5);
    assert.equal((await readFeed(sql,[u1.id])).length,0);
    assert.equal((await readSkills(sql,[u1.id])).length,0);
    const skill=(await readSkills(sql,[u1.id,u2.id]))[0];
    assert.deepEqual(skill.action_items,[]);
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
    await sql`UPDATE video_results SET review_status='approved',review_feedback=${JSON.stringify({judge:'short-judge-v1',passed:true,captions_burned:true})}`;
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

test('public catalogue, private media, legacy duplicates and failed judges obey the same access boundary',async()=>{
  const {sqlite,env,sql}=database();
  const call=(path,body,cookie)=>app.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{});
  const receipt=JSON.stringify({judge:'short-judge-v1',passed:true,captions_burned:true});
  try {
    const signup=await call('/api/auth/signup',{email:'owner@example.com',password:'correct horse battery'});
    const cookie=signup.headers.get('set-cookie').split(';')[0];
    const second=await call('/api/auth/signup',{email:'other@example.com',password:'correct horse battery'});
    const otherCookie=second.headers.get('set-cookie').split(';')[0];
    const imported=await (await call('/api/imports',{links:['https://youtu.be/VQy50fuxI34','https://www.youtube.com/watch?v=VQy50fuxI34&t=30']},cookie)).json();
    assert.equal(imported.units.length,2,'distinct start times remain separate imports');
    assert.notEqual((await (await call('/api/imports',{links:['https://youtu.be/VQy50fuxI34?t=60']},cookie)).json()).units[0].id,imported.units[0].id);
    assert.equal((await (await call('/api/imports',{links:['https://www.youtube.com/watch?v=VQy50fuxI34&t=30s']},cookie)).json()).units[0].id,imported.units[1].id);
    const u=imported.units[0];
    const concurrent=await Promise.all([30,30].map(t=>call('/api/imports',{links:[`https://youtu.be/V-EDrhIhHzQ?t=${t}`]},cookie)));
    const concurrentIds=await Promise.all(concurrent.map(async r=>(await r.json()).units[0].id));
    assert.equal(new Set(concurrentIds).size,1,'parallel submissions of the same URL and start time link once');
    assert.equal((await sql`SELECT count(*) AS n FROM user_imports`)[0].n,4);
    for (const n of [1,2]) {
      const [a]=await sql`INSERT INTO artifacts(name,source_url,source_ids,sources,processed_text,ingestion_status)
        VALUES('Source-backed lesson',${u.source_url},${JSON.stringify([u.id])},${JSON.stringify([{url:u.source_url,title:'Source'}])},'Content','ready') RETURNING id`;
      await sql`INSERT INTO video_results(artifact_id,artifact_version,status,media_ref,caption_ref,narration_ref,duration_seconds,review_status,review_feedback)
        VALUES(${a.id},1,'ready',${`r2:videos/${n}/1/short.mp4`},${`r2:captions/${n}/1/short.vtt`},'audio',30,'approved',${receipt})`;
      await sql`INSERT INTO skill_results(artifact_id,artifact_version,status,skill_markdown) VALUES(${a.id},1,'ready','---\nname: check\ndescription: "Check when changing code"\n---\nInspect the source.')`;
    }
    await sql`UPDATE skill_results SET review_feedback=${JSON.stringify({prompt_revision:SKILL_PROMPT_REVISION})}`;
    assert.equal((await (await call('/api/feed',null,cookie)).json()).items.length,1,'historical duplicate shorts hidden');
    assert.equal((await (await call('/api/skills',null,cookie)).json()).skills.length,1,'historical duplicate skills hidden');
    assert.deepEqual(await (await call('/api/feed',null,otherCookie)).json(),{items:[]});
    assert.deepEqual(await (await call('/api/feed?scope=public')).json(),{items:[]});
    assert.deepEqual(await (await call('/api/skills?scope=public')).json(),{skills:[]});
    env.MEDIA={async head(){return {size:4,httpEtag:'test',writeHttpMetadata(h){h.set('content-type','video/mp4')}}},async get(){return {body:'clip',size:4,httpEtag:'test',writeHttpMetadata(h){h.set('content-type','video/mp4')}}}};
    assert.equal((await call('/media/videos/1/1/short.mp4')).status,404);
    assert.equal((await call('/media/videos/1/1/short.mp4',null,otherCookie)).status,404);
    const owned=await call('/media/videos/1/1/short.mp4',null,cookie);
    assert.equal(owned.status,200);
    assert.equal(owned.headers.get('cache-control'),'private, no-store');
    await sql`UPDATE video_results SET feed_order=1 WHERE media_ref='r2:videos/1/1/short.mp4'`;
    assert.equal((await (await call('/api/feed?scope=public')).json()).items.length,1);
    const publicSkills=(await (await call('/api/skills?scope=public')).json()).skills;
    assert.equal(publicSkills.length,1);
    assert.deepEqual(publicSkills[0].action_items,[]);
    assert.doesNotMatch(JSON.stringify(publicSkills),/owner@example|password|user_id/);
    assert.equal((await call('/media/videos/1/1/short.mp4')).status,200);
    await sql`UPDATE video_results SET review_feedback='human legacy approval'`;
    assert.deepEqual(await (await call('/api/feed?scope=public')).json(),{items:[]});
    assert.equal((await call('/media/videos/1/1/short.mp4')).status,404);
    await sql`UPDATE video_results SET review_feedback=${JSON.stringify({judge:'short-judge-v1',passed:false,captions_burned:true})}`;
    assert.deepEqual(await (await call('/api/feed',null,cookie)).json(),{items:[]});
    assert.equal((await call('/api/handoffs',{skill_ids:['unused']},cookie)).status,410);
    assert.equal((await sql`SELECT count(*) AS n FROM artifacts`)[0].n,2,'no production-style rows deleted');
  } finally {sqlite.close();}
});

test('exact canonical source sets keep segments and combined lessons, with matching reel skill cards',async()=>{
  const {sqlite,sql}=database();
  try {
    const url='https://www.youtube.com/watch?v=VQy50fuxI34';
    const units=[];
    for (const [source,start] of [[url,null],[url,null],[url,3600],['https://www.youtube.com/watch?v=V-EDrhIhHzQ',null]]) {
      const [unit]=await sql`INSERT INTO ingested_units(submitted_url,source_url,start_seconds,status,transcript) VALUES(${source},${source},${start},'ready','{}') RETURNING id`;
      units.push(unit.id);
    }
    const artifacts=[];
    const receipt={judge:'short-judge-v1',passed:true,captions_burned:true};
    for (const [i,sources] of [[units[0]],[units[1]],[units[2]],[units[0],units[3]],[units[3],units[1]]].entries()) {
      const [a]=await sql`INSERT INTO artifacts(name,source_url,source_ids,processed_text,ingestion_status,created_at)
        VALUES('Saved lesson',${url},${JSON.stringify(sources)},'Source-backed procedure','ready',${`2026-10-${10+i}T00:00:00Z`}) RETURNING id`;
      artifacts.push(a.id);
      await sql`INSERT INTO video_results(artifact_id,artifact_version,status,media_ref,caption_ref,narration_ref,duration_seconds,feed_order,review_status,review_feedback)
        VALUES(${a.id},1,'ready',${`r2:videos/${a.id}/1/short.mp4`},'captions','audio',30,${i+1},'approved',${JSON.stringify({...receipt,passed:i!==1})})`;
      await sql`INSERT INTO skill_results(artifact_id,artifact_version,status,skill_markdown,review_feedback)
        VALUES(${a.id},1,'ready','---\nname: saved-lesson\ndescription: "Use when inspecting source material"\n---\nInspect the source.',${JSON.stringify({prompt_revision:SKILL_PROMPT_REVISION})})`;
    }
    for (const scope of [null,units]) {
      const feed=await readFeed(sql,scope),skills=await readSkills(sql,scope);
      assert.deepEqual(feed.map(item=>item.id),[artifacts[0],artifacts[2],artifacts[3]]);
      assert.equal(skills.length,3);
      for (const item of feed) assert.ok(skills.some(s=>s.artifact.id===item.id && s.artifact.version===item.version && s.status==='ready'));
    }
    assert.equal((await readUnits(sql,units)).length,3,'only identical URL and start pairs collapse in progress');
  } finally {sqlite.close();}
});

test('legacy skill text stays withheld in both projections until a successful regeneration',async()=>{
  const {sqlite,sql}=database();
  try {
    const [unit]=await sql`INSERT INTO ingested_units(submitted_url,source_url,status,transcript) VALUES('https://youtu.be/VQy50fuxI34','https://www.youtube.com/watch?v=VQy50fuxI34','ready','{}') RETURNING id`;
    const [a]=await sql`INSERT INTO artifacts(name,source_url,source_ids,processed_text,ingestion_status) VALUES('Saved lesson','https://www.youtube.com/watch?v=VQy50fuxI34',${JSON.stringify([unit.id])},'Source text','ready') RETURNING id`;
    const old='---\nname: old-skill\n---\nOld procedure';
    await sql`INSERT INTO skill_results(artifact_id,artifact_version,status,skill_markdown) VALUES(${a.id},1,'ready',${old})`;
    await sql`INSERT INTO video_results(artifact_id,artifact_version,status,media_ref,caption_ref,narration_ref,duration_seconds,feed_order,review_status,review_feedback)
      VALUES(${a.id},1,'ready','r2:videos/legacy/1/short.mp4','captions','audio',30,1,'approved',${JSON.stringify({judge:'short-judge-v1',passed:true,captions_burned:true})})`;
    for (const scope of [null,[unit.id]]) {
      const [skill]=await readSkills(sql,scope);
      assert.deepEqual([skill.status,skill.name,skill.description,skill.markdown],['regenerating',null,null,null]);
      assert.equal((await readFeed(sql,scope))[0].skill.status,'regenerating');
    }
    for (const status of ['running','failed']) {
      await sql`UPDATE skill_results SET status=${status},review_feedback='{"regenerating":true}',attempts=3,error=${status==='failed'?'provider unavailable':null}`;
      const [skill]=await readSkills(sql,[unit.id]);
      assert.equal(skill.status,'regenerating');
      assert.equal(skill.markdown,null);
      assert.equal(skill.retrying,false);
      assert.equal((await readFeed(sql,[unit.id]))[0].skill.status,'regenerating');
    }
    assert.equal((await sql`SELECT skill_markdown FROM skill_results`)[0].skill_markdown,old);
    const updated='---\nname: concise-skill\n---\nInspect the source.';
    await sql`UPDATE skill_results SET status='ready',skill_markdown=${updated},review_feedback=${JSON.stringify({prompt_revision:SKILL_PROMPT_REVISION})},error=NULL`;
    for (const scope of [null,[unit.id]]) {
      assert.equal((await readSkills(sql,scope))[0].markdown,updated);
      assert.equal((await readFeed(sql,scope))[0].skill.status,'ready');
    }
  } finally {sqlite.close();}
});


test('skill choices are account-scoped, atomic, idempotent and default to skills only', async () => {
  const {sqlite,env,sql}=database();
  const call=(path,body,cookie)=>app.fetch(new Request(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,{});
  try {
    const signup=await call('/api/auth/signup',{email:'choices@example.com',password:'correct horse battery'});
    const {user}=await signup.json(),cookie=signup.headers.get('set-cookie').split(';')[0];
    const other=await call('/api/auth/signup',{email:'other-choices@example.com',password:'correct horse battery'});
    const otherCookie=other.headers.get('set-cookie').split(';')[0];
    const [unit]=await sql`INSERT INTO ingested_units(submitted_url,source_url) VALUES('x','https://x.com/i/status/123') RETURNING id`;
    await sql`INSERT INTO user_imports(user_id,unit_id) VALUES(${user.id},${unit.id})`;
    const ids=[];
    for (const name of ['Check first','Read the source']) {
      const [source]=await sql`INSERT INTO ingested_units(submitted_url,source_url) VALUES(${name},${`https://x.com/i/status/${123+ids.length}`}) RETURNING id`;
      await sql`INSERT INTO user_imports(user_id,unit_id) VALUES(${user.id},${source.id})`;
      const [a]=await sql`INSERT INTO artifacts(name,source_url,source_ids,processed_text,ingestion_status) VALUES(${name},'https://x.com/i/status/123',${JSON.stringify([source.id])},'content','ready') RETURNING id`;
      await sql`INSERT INTO skill_results(artifact_id,artifact_version,status,skill_markdown,review_feedback) VALUES(${a.id},1,'ready','---\nname: check\ndescription: Check the source\n---\nRead it',${JSON.stringify({prompt_revision:SKILL_PROMPT_REVISION})})`;
      ids.push(a.id);
    }
    const body={choices:ids.map((id,i)=>({id,version:1,keep:i===0})),generateVideos:false};
    assert.equal((await call('/api/skills/choices',body)).status,401);
    assert.equal((await call('/api/skills/choices',body,otherCookie)).status,409);
    assert.equal((await call('/api/skills/choices',{...body,choices:[...body.choices,{id:'foreign',version:1,keep:true}]},cookie)).status,409);
    assert.equal((await sql`SELECT * FROM user_skill_choices`).length,0);
    for(let i=0;i<2;i++) assert.equal((await call('/api/skills/choices',body,cookie)).status,200);
    const rows=await sql`SELECT * FROM user_skill_choices`;
    assert.equal(rows.length,2);
    assert.ok(rows.every(r=>r.video_requested===0));
    const kept=await (await call('/api/skills',null,cookie)).json();
    assert.equal(kept.skills.length,1);
    assert.equal(kept.skills[0].kept,true);
    assert.equal((await call('/api/skills/choices',{...body,generateVideos:true},cookie)).status,200);
    assert.deepEqual((await sql`SELECT video_requested FROM user_skill_choices ORDER BY kept DESC`).map(r=>r.video_requested),[1,0]);
    // Sharing the source gives the second account an independent review, not the first account's discard.
    const otherUser=await (await call('/api/me',null,otherCookie)).json();
    await sql`INSERT INTO user_imports(user_id,unit_id) SELECT ${otherUser.user.id},unit_id FROM user_imports WHERE user_id=${user.id}`;
    assert.equal((await (await call('/api/skills',null,otherCookie)).json()).skills.length,2);
  } finally {sqlite.close();}
});

test('imports enforce the account window under concurrency, isolate accounts and recover', async () => {
  const { sqlite, env, sql } = database();
  const calls = [];
  let now = 0;
  const windows = new Map();
  env.IMPORT_LIMITER = { async limit({ key }) {
    calls.push(key);
    const window = Math.floor(now / 60);
    const entry = windows.get(key);
    const count = entry?.window === window ? entry.count + 1 : 1;
    windows.set(key, { window, count });
    return { success: count <= 5 };
  } };
  const call = (path, body, cookie, ip = '192.0.2.1') => app.fetch(new Request(`https://resurface.test${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }), env, {});
  try {
    const cookies = [];
    const ids = [];
    for (const email of ['limited@example.com', 'isolated@example.com']) {
      const response = await call('/api/auth/signup', { email, password: 'correct horse battery' });
      assert.equal(response.status, 201);
      cookies.push(response.headers.get('set-cookie').split(';')[0]);
      ids.push((await response.json()).user.id);
    }
    assert.equal((await call('/api/imports', {})).status, 401);
    assert.deepEqual(calls, [], 'anonymous requests cannot consume an account limit');
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      call('/api/imports', {}, cookies[0], `192.0.2.${i + 1}`)));
    assert.deepEqual(responses.map(r => r.status).sort(), [400, 400, 400, 400, 400, 429, 429, 429]);
    for (const response of responses.filter(r => r.status === 429)) {
      assert.equal(response.headers.get('retry-after'), '60');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.deepEqual(calls, Array(8).fill(ids[0]), 'changing IP does not reset the account limit');
    assert.equal((await call('/api/imports', {}, cookies[1])).status, 400, 'another account on the same IP has its own window');
    assert.equal(calls.at(-1), ids[1]);
    now = 60;
    assert.equal((await call('/api/imports', {}, cookies[0])).status, 400, 'requests reach validation again after recovery');
    for (const limiter of [undefined, { async limit() { throw new Error('unavailable'); } }]) {
      env.IMPORT_LIMITER = limiter;
      assert.equal((await call('/api/imports', { links: ['https://youtu.be/VQy50fuxI34'] }, cookies[0])).status, 503);
    }
    assert.equal((await sql`SELECT count(*) AS n FROM user_imports`)[0].n, 0);
    assert.equal((await sql`SELECT count(*) AS n FROM ingested_units`)[0].n, 0);
  } finally { sqlite.close(); }
});

async function videoAccount(env,sql,email) {
  const signup=await app.fetch(new Request('http://localhost/api/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'isolated-test-password'})}),env,{});
  const {user}=await signup.json(),cookie=signup.headers.get('set-cookie').split(';')[0];
  const ids=[];
  for(let i=0;i<2;i++) {
    const [unit]=await sql`INSERT INTO ingested_units(submitted_url,source_url,status,transcript) VALUES('test',${`https://x.com/i/status/${100+i}`},'ready','{}') RETURNING id`;
    await sql`INSERT INTO user_imports(user_id,unit_id) VALUES(${user.id},${unit.id})`;
    const [a]=await sql`INSERT INTO artifacts(name,source_url,source_ids,processed_text,ingestion_status) VALUES('Check first',${`https://x.com/i/status/${100+i}`},${JSON.stringify([unit.id])},'Read the saved source','ready') RETURNING id`;
    await sql`INSERT INTO skill_results(artifact_id,artifact_version,status,skill_markdown,review_feedback) VALUES(${a.id},1,'ready','---\nname: check-first\ndescription: Check the saved source\n---\nRun the check.',${JSON.stringify({prompt_revision:SKILL_PROMPT_REVISION})})`;
    ids.push(a.id);
  }
  const request=(id)=>app.fetch(new Request('http://localhost/api/skills/choices',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({choices:[{id,version:1,keep:true}],generateVideos:true})}),env,{});
  return {user,cookie,ids,request};
}

test('one lifetime video slot survives concurrent requests, retries, failure and a changed selection',async()=>{
  const {sqlite,env,sql}=database();
  try {
    const a=await videoAccount(env,sql,'one-video@example.test');
    const responses=await Promise.all(Array.from({length:12},(_,i)=>a.request(a.ids[i%2])));
    assert.ok(responses.some(r=>r.status===200));
    assert.ok(responses.some(r=>r.status===409));
    const [slot]=await sql`SELECT * FROM user_video_requests WHERE user_id=${a.user.id}`;
    assert.equal((await sql`SELECT * FROM user_video_requests`).length,1);
    assert.equal((await a.request(slot.artifact_id)).status,200,'same request is idempotent');
    const other=a.ids.find(id=>id!==slot.artifact_id);
    assert.equal((await a.request(other)).status,409,'a second selection is refused server-side');
    await sql`INSERT INTO video_results(artifact_id,artifact_version,status,attempts,error) VALUES(${slot.artifact_id},1,'failed',3,'fixture-provider-failure')`;
    const failed=await (await a.request(other)).json();
    assert.equal(failed.video.status,'failed');
    assert.match(failed.video.message,/couldn't be made/);
    assert.doesNotMatch(failed.video.message,/fixture-provider/);
    await sql`UPDATE video_results SET status='ready',media_ref='r2:videos/one/short.mp4',caption_ref='r2:captions/one.vtt',narration_ref='r2:audio/one.m4a',duration_seconds=25,review_status='approved',review_feedback=${JSON.stringify({judge:'short-judge-v1',passed:true,captions_burned:true})}`;
    const ready=await (await a.request(other)).json();
    assert.equal(ready.video.url,'/media/videos/one/short.mp4');
    assert.match(ready.error,/already made/);
    assert.equal((await sql`SELECT * FROM user_video_requests`).length,1);
  } finally {sqlite.close();}
});

for(const [daily,monthly] of [[20,400],[20,1]]) {
  test(`video admission respects daily/monthly ceilings under parallel requests (${daily}/${monthly})`,async()=>{
    const {sqlite,env,sql}=database();
    Object.assign(env,{DAILY_VIDEO_LIMIT:String(daily),MONTHLY_VIDEO_LIMIT:String(monthly)});
    try {
      const accounts=[];
      for(let i=0;i<22;i++) accounts.push(await videoAccount(env,sql,`budget-${i}@example.test`));
      const responses=await Promise.all(accounts.map(a=>a.request(a.ids[0])));
      assert.equal(responses.filter(r=>r.status===200).length,Math.min(daily,monthly));
      const denied=responses.find(r=>r.status===429);
      const detail=await denied.json();
      assert.match(detail.error,/video limit.*Try again after .*UTC/);
      assert.ok(detail.retryAt);
      assert.equal((await sql`SELECT * FROM user_video_requests`).length,Math.min(daily,monthly));
    } finally {sqlite.close();}
  });
}

test('migration preserves historical ready videos and assigns only one lifetime slot',async()=>{
  const {sqlite,env,sql}=database();
  try {
    sqlite.exec('DROP TABLE video_starts; DROP TABLE user_video_requests');
    const a=await videoAccount(env,sql,'historical-video@example.test');
    for(const [i,id] of a.ids.entries()) {
      await sql`INSERT INTO user_skill_choices(user_id,artifact_id,artifact_version,kept,video_requested) VALUES(${a.user.id},${id},1,1,1)`;
      await sql`INSERT INTO video_results(artifact_id,artifact_version,status,attempts,media_ref,caption_ref,narration_ref,duration_seconds,review_status,review_feedback) VALUES(${id},1,'ready',0,${`r2:videos/history-${i}/short.mp4`},'r2:captions/history.vtt','audio',25,'approved',${JSON.stringify({judge:'short-judge-v1',passed:true,captions_burned:true})})`;
    }
    sqlite.exec(readFileSync(new URL('../migrations/0007_video_limits.sql',import.meta.url),'utf8'));
    const [slot]=await sql`SELECT * FROM user_video_requests`;
    assert.ok(slot);
    assert.equal((await sql`SELECT * FROM user_video_requests`).length,1);
    assert.equal((await sql`SELECT * FROM video_results`).length,2,'no historical media row is deleted');
    assert.equal((await sql`SELECT * FROM user_skill_choices WHERE video_requested=1`).length,1);
    const response=await a.request(a.ids.find(id=>id!==slot.artifact_id));
    assert.equal(response.status,409);
    const body=await response.json();
    assert.match(body.error,/already made/);
    assert.match(body.video.url,/^\/media\/videos\/history-/);
  } finally {sqlite.close();}
});

test('zero and invalid video admission limits fail closed without consuming an account slot',async()=>{
  const {sqlite,env,sql}=database();
  try {
    const a=await videoAccount(env,sql,'paused-video@example.test');
    for(const value of ['0','invalid','-1']) {
      env.DAILY_VIDEO_LIMIT=value;
      const response=await a.request(a.ids[0]);
      assert.equal(response.status,503);
      assert.match((await response.json()).error,/paused/);
      assert.equal((await sql`SELECT * FROM user_video_requests`).length,0);
    }
  } finally {sqlite.close();}
});
