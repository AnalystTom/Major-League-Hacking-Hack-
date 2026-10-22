import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers.js';
import { D1Store } from '../../src/ingest/store.js';
import { D1OutputStore } from '../../src/outputs/store.js';
import { D1HandoffStore } from '../../src/outputs/handoff-store.js';
import { processUnits, sweepOnce } from '../../src/ingest/processor.js';
import { mockFetch } from '../ingest/helpers.js';
import { UNLIMITED } from '../../src/ingest/limits.js';
import { DEFAULT_CATEGORIZATION_REQUEST, promptRevisionText } from '../../src/ingest/digest/prompt.js';
import { SKILL_PROMPT_REVISION } from '../../src/outputs/skills.js';
import { readFeed, canReadMedia } from '../../../web/src/feed.js';
import { decodeRow as decodeWebRow } from '../../../web/src/db.js';
import type { RenderedVideo } from '../../src/outputs/types.js';

async function setup() {
  const { db,sqlite }=testDatabase();
  const store=new D1Store(db),outputs=new D1OutputStore(db),handoffs=new D1HandoffStore(db);
  const user=(await db.query("INSERT INTO users(email,password_hash) VALUES(?1,'x') RETURNING id",[`test-${randomUUID()}@example.com`])).rows[0].id;
  async function unit(status='pending') {
    const id=randomUUID();
    await db.query(`INSERT INTO ingested_units(id,submitted_url,source_url,status,transcript) VALUES(?1,?2,?2,?3,?4)`,
      [id,'https://www.youtube.com/watch?v=VQy50fuxI34',status,status==='ready' ? '{"evidence_items":[]}' : null]);
    await db.query('INSERT INTO user_imports(user_id,unit_id) VALUES(?1,?2)',[user,id]);
    return id;
  }
  const prompt=await store.registerPrompt('test',[]);
  async function artifact(ids: string[]) {
    return (await store.saveArtifacts([{ name:'Check first',source_ids:ids,category:'Evals',processed_text:'content',selection_reason:'reason',evidence:[] }],[],prompt))[0];
  }
  return { db,sqlite,store,outputs,handoffs,user,unit,prompt,artifact };
}

test('D1 stores preserve extraction, prompt revisions, artifacts and failed digest retry limits',async()=>{
  const s=await setup();
  try {
    assert.equal(await s.store.registerPrompt('test',[]),s.prompt);
    assert.notEqual(await s.store.registerPrompt('test',[{example:1}]),s.prompt);
    const id=await s.unit();
    const { impl,calls }=mockFetch();
    const options={ store:s.store,geminiKey:'k',openaiKey:'o',fetchImpl:impl,retries:0,pollMs:5,waitTimeoutMs:5000,limits:UNLIMITED };
    await Promise.all([processUnits([id],options),processUnits([id],options)]);
    assert.equal(calls.gemini,1);
    assert.equal((await s.store.getUnits([id]))[0].status,'ready');
    assert.equal((await s.store.getUnits([id]))[0].title,'Real Title');
    assert.equal((await s.store.getUnits([id]))[0].transcript?.evidence_items.length,1);
    assert.equal((await s.store.unitsNeedingDigest([id],s.prompt)).length,0);
    const a=(await s.db.query('SELECT * FROM artifacts')).rows[0];
    assert.deepEqual(a.source_ids,[id]);
    await assert.rejects(s.db.query("UPDATE artifacts SET processed_text='changed' WHERE id=?1",[a.id]),/immutable/);
    await s.db.query("UPDATE artifacts SET review_status='approved' WHERE id=?1",[a.id]);
    await s.db.query('INSERT INTO artifacts(id,version,name,source_url,source_ids,processed_text,ingestion_status) SELECT id,2,name,source_url,source_ids,\'revised\',\'ready\' FROM artifacts WHERE id=?1',[a.id]);
    const retry=await s.unit('ready');
    for(let i=0;i<3;i++) await s.store.saveFailedArtifacts([retry],'actual error',s.prompt);
    assert.equal((await s.store.listUnitsNeedingDigest(50,s.prompt)).some((r)=>r.unitId===retry),false);
    assert.ok((await s.db.query('SELECT error FROM artifacts WHERE ingestion_status=\'failed\'')).rows.every((r)=>r.error==='actual error'));
    await assert.rejects(s.db.query("INSERT INTO ingested_units(submitted_url,source_url,transcript) VALUES('x','x','invalid json')"),/CHECK/);
  } finally { s.sqlite.close(); }
});

test('D1 requests and sweeps reconsider old exclusions while preserving current exclusions',async()=>{
  const s=await setup();
  try {
    const direct=await s.unit('ready'),scheduled=await s.unit('ready'),excluded=await s.unit('ready');
    const ids=[direct,scheduled,excluded];
    const transcript={window:[0,0],evidence_items:[{start_seconds:0,end_seconds:0,observed_spoken_content:'How to grow a sourdough starter.'}]};
    await s.db.query('UPDATE ingested_units SET transcript=?1',[JSON.stringify(transcript)]);
    await s.store.saveArtifacts([],ids.map((unit_id)=>({unit_id,reason:'Not engineering.'})),s.prompt);
    assert.deepEqual(await s.store.unitsNeedingDigest(ids,s.prompt),[]);
    assert.deepEqual(await s.store.listUnitsNeedingDigest(50,s.prompt),[]);
    const current=await s.store.registerPrompt(promptRevisionText(DEFAULT_CATEGORIZATION_REQUEST),[]);
    await s.store.saveArtifacts([],[{unit_id:excluded,reason:'Nothing to explain.'}],current);
    assert.deepEqual((await s.store.unitsNeedingDigest(ids,current)).sort(),[direct,scheduled].sort());
    assert.deepEqual((await s.store.listUnitsNeedingDigest(50,current)).map((r)=>r.unitId).sort(),[direct,scheduled].sort());
    const { impl,calls }=mockFetch();
    const options={store:s.store,geminiKey:'k',openaiKey:'o',fetchImpl:impl};
    assert.equal((await processUnits([direct],options)).digested,1);
    assert.equal(await sweepOnce(options),1);
    assert.equal(calls.openai,2);
    assert.equal(calls.gemini,0);
    assert.deepEqual(await s.store.unitsNeedingDigest(ids,current),[]);
    assert.deepEqual(await s.store.listUnitsNeedingDigest(50,current),[]);
    assert.equal((await s.db.query('SELECT count(*) AS n FROM artifact_exclusions')).rows[0].n,4);
  } finally { s.sqlite.close(); }
});

test('atomic D1 extraction and digest reservations never exceed the last daily/monthly slot',async()=>{
  const s=await setup();
  try {
    const ids=await Promise.all([s.unit(),s.unit(),s.unit(),s.unit()]);
    const limits={daily:1,monthly:10};
    const [a,b]=await Promise.all([s.store.claimWithinLimits(ids.slice(0,2),limits),s.store.claimWithinLimits(ids.slice(2),limits)]);
    assert.equal(a.claimed.length+b.claimed.length,1);
    assert.equal(a.deferred.length+b.deferred.length,3);
    assert.ok([...a.deferred,...b.deferred].length===3);
    const again=await s.store.claimWithinLimits(ids,{daily:4,monthly:4});
    assert.equal(again.claimed.length,3);
    assert.equal((await s.db.query('SELECT count(*) AS n FROM processing_starts WHERE charged=1')).rows[0].n,4);
    assert.deepEqual((await s.store.reserveDigests(ids,{daily:0,monthly:0})).allowed,ids,'extraction covers first digest');
    const repeat=await s.store.reserveDigests(ids,{daily:5,monthly:5});
    assert.equal(repeat.allowed.length,1);
    assert.equal(repeat.deferred.length,3);
    assert.ok(repeat.resumesAt!>new Date());
    assert.equal((await s.store.reserveDigests(ids,{daily:5,monthly:5})).allowed.length,0);
  } finally { s.sqlite.close(); }
});

test('D1 outputs retain claim ownership, bounded retries and skills-only writes without deleting stored tasks',async()=>{
  const s=await setup();
  try {
    const id=await s.unit('ready'),a=await s.artifact([id]);
    const art=(await s.outputs.artifactsNeeding('skill',50))[0];
    assert.deepEqual(art.source_ids,[id]);
    const [c1,c2]=await Promise.all([s.outputs.claim('skill',art),s.outputs.claim('skill',art)]);
    assert.ok((c1===null)!==(c2===null));
    const c=(c1??c2)!;
    assert.equal(await s.outputs.claim('skill',art),null);
    await s.outputs.fail('skill',c,'provider failed');
    assert.equal(await s.outputs.claim('skill',art),null,'backoff');
    await s.db.query("UPDATE skill_results SET updated_at='2000-01-01T00:00:00Z' WHERE id=?1",[c.id]);
    const second=(await s.outputs.claim('skill',art))!;
    assert.notEqual(second.token,c.token);
    const skill={skill_markdown:'---\nname: check-first\ndescription: "Check"\n---\nbody',supporting_refs:art.sources,
      action_items:[{task:'Check',applicability_evidence:[],prerequisites:[],steps:['Inspect'],source_refs:[id],completion_check:'Verified'}]};
    await assert.rejects(s.outputs.finishSkill(c,skill),/taken over/);
    await s.db.query("INSERT INTO action_items(skill_result_id,task,steps,completion_check) VALUES(?1,'Historical task','[\"Inspect\"]','Checked')",[second.id]);
    await s.outputs.finishSkill(second,skill);
    await assert.rejects(s.outputs.finishSkill(second,{...skill,action_items:[]}),/taken over/);
    assert.equal((await s.db.query('SELECT count(*) AS n FROM action_items')).rows[0].n,1,'lost claim cannot delete tasks');
    assert.deepEqual((await s.handoffs.loadSkills([second.id]))[0].action_items[0].steps,['Inspect']);
    assert.deepEqual(await s.outputs.skillCard(art),{status:'ready',card:{name:'check-first',description:'Check'}});
    const v=(await s.outputs.claim('video',art))!;
    await assert.rejects(s.db.query("UPDATE video_results SET status='ready' WHERE id=?1",[v.id]),/CHECK|positive duration/);
    await s.db.query("UPDATE video_results SET updated_at='2000-01-01T00:00:00Z' WHERE id=?1",[v.id]);
    const v2=(await s.outputs.claim('video',art))!;
    const rendered={judgment:{judge:'short-judge-v1' as const,passed:true,captions_burned:true as const,scores:{grounding:4,clarity:4,usefulness:4,visuals:4,subtitles:4},reasons:[]},script:{scenes:[]},prompt_revision:'script-v1',media_ref:`r2:videos/${a.id}/1/short.mp4`,caption_ref:`r2:captions/${a.id}/1/short.vtt`,narration_ref:`r2:audio/${a.id}/1/narration.m4a`,duration_seconds:34.5,music_provenance:'Licensed test provenance'};
    await assert.rejects(s.outputs.finishVideo(v,rendered),/taken over/);
    assert.equal(await s.outputs.fail('video',v,'late'),false);
    await s.outputs.finishVideo(v2,rendered);
    assert.equal((await s.db.query('SELECT music_provenance FROM video_results WHERE id=?1',[v2.id])).rows[0].music_provenance,rendered.music_provenance);
    assert.equal(await s.outputs.claim('video',art),null);
    const b=await s.artifact([await s.unit('ready')]),retry={...art,id:b.id};
    const failed=(await s.outputs.claim('skill',retry))!;
    await s.outputs.fail('skill',failed,'failed');
    for(let i=0;i<2;i++) {
      await s.db.query("UPDATE skill_results SET updated_at='2000-01-01T00:00:00Z' WHERE id=?1",[failed.id]);
      const retryClaim=(await s.outputs.claim('skill',retry))!;
      await s.outputs.fail('skill',retryClaim,'failed');
    }
    await s.db.query("UPDATE skill_results SET updated_at='2000-01-01T00:00:00Z' WHERE id=?1",[failed.id]);
    assert.equal(await s.outputs.claim('skill',retry),null);
  } finally { s.sqlite.close(); }
});

test('D1 shared digests stay private and handoff claims survive migration',async()=>{
  const s=await setup();
  try {
    const shared=await s.unit('ready'),privateId=await s.unit('ready');
    const a=await s.artifact([shared,privateId]);
    const other=(await s.db.query("INSERT INTO users(email,password_hash) VALUES('other@example.com','x') RETURNING id")).rows[0].id;
    await s.db.query('INSERT INTO user_imports(user_id,unit_id) VALUES(?1,?2)',[other,shared]);
    assert.deepEqual(await s.store.unitsNeedingDigest([shared,privateId],s.prompt),[shared]);
    assert.equal((await s.store.listUnitsNeedingDigest(50,s.prompt))[0].userId,other);
    const skill=(await s.db.query("INSERT INTO skill_results(artifact_id,artifact_version,status,skill_markdown) VALUES(?1,1,'ready','---\nname: test\n---\nbody') RETURNING id",[a.id])).rows[0].id;
    const brief=(await s.db.query("INSERT INTO agent_briefs(user_id,skill_result_ids,input_key) VALUES(?1,?2,'k') RETURNING id",[s.user,JSON.stringify([skill])])).rows[0].id;
    const claim=(await s.handoffs.claim(brief))!;
    assert.deepEqual(claim.skill_result_ids,[skill]);
    assert.equal(await s.handoffs.claim(brief),null);
    assert.equal(await s.handoffs.fail({...claim,token:randomUUID()},'late'),false);
    assert.equal(await s.handoffs.fail(claim,'actual error'),true);
    assert.equal((await s.db.query('SELECT error FROM agent_briefs WHERE id=?1',[brief])).rows[0].error,'actual error');
  } finally { s.sqlite.close(); }
});


test('artifact creation reuses an identical source set and a quality rejection cannot be retried into publication',async()=>{
  const s=await setup();
  try {
    const id=await s.unit('ready');
    const [a,b]=await Promise.all([s.artifact([id]),s.artifact([id])]);
    assert.equal(a.id,b.id);
    assert.equal((await s.db.query('SELECT count(*) AS n FROM artifacts')).rows[0].n,1);
    const claim=(await s.outputs.claim('video',a))!;
    await s.outputs.fail('video',claim,'Quality judge rejected: unsupported claim');
    await s.db.query("UPDATE video_results SET updated_at='2000-01-01T00:00:00Z'");
    assert.equal(await s.outputs.claim('video',a),null);
    assert.deepEqual(await s.outputs.artifactsNeeding('video',10),[]);
    assert.match((await s.db.query('SELECT error FROM video_results')).rows[0].error,/unsupported claim/);
  } finally {s.sqlite.close();}
});

test('legacy skills regenerate once without exposing old text or retrying a failed refresh',async()=>{
  const s=await setup();
  try {
    const artifacts=await Promise.all([s.unit('ready'),s.unit('ready')].map(async id=>s.artifact([await id])));
    const old='---\nname: legacy-skill\n---\nOld procedure';
    for (const a of artifacts) await s.db.query("INSERT INTO skill_results(artifact_id,artifact_version,status,skill_markdown,attempts,review_feedback) VALUES(?1,1,'ready',?2,1,?3)",[a.id,old,JSON.stringify({prompt_revision:'skill-v3'})]);
    const needing=await s.outputs.artifactsNeeding('skill',10);
    assert.equal(needing.length,2);
    const [a,b]=needing;
    assert.deepEqual(await s.outputs.skillCard(a),{status:'pending',card:null});
    const ids=(await s.db.query('SELECT id FROM skill_results')).rows.map(r=>r.id);
    assert.deepEqual(await s.handoffs.loadSkills(ids),[]);
    const claims=await Promise.all([s.outputs.claim('skill',a),s.outputs.claim('skill',a)]);
    assert.equal(claims.filter(Boolean).length,1);
    const claim=claims.find(Boolean)!;
    await s.db.query("UPDATE skill_results SET updated_at='2000-01-01T00:00:00Z' WHERE id=?1",[claim.id]);
    assert.equal(await s.outputs.claim('skill',a),null);
    await s.outputs.finishSkill(claim,{skill_markdown:'---\nname: concise-skill\ndescription: Inspect the source.\n---\nInspect the source.',supporting_refs:[],action_items:[]});
    assert.equal(await s.outputs.claim('skill',a),null);
    assert.deepEqual(await s.outputs.skillCard(a),{status:'ready',card:{name:'concise-skill',description:'Inspect the source.'}});
    assert.equal((await s.handoffs.loadSkills(ids)).length,1);
    assert.deepEqual(JSON.parse((await s.db.query('SELECT review_feedback FROM skill_results WHERE id=?1',[claim.id])).rows[0].review_feedback),{prompt_revision:SKILL_PROMPT_REVISION});
    const failed=(await s.outputs.claim('skill',b))!;
    await s.outputs.fail('skill',failed,'provider unavailable');
    await s.db.query("UPDATE skill_results SET updated_at='2000-01-01T00:00:00Z' WHERE id=?1",[failed.id]);
    assert.equal(await s.outputs.claim('skill',b),null);
    assert.deepEqual(await s.outputs.artifactsNeeding('skill',10),[]);
    assert.deepEqual(await s.outputs.skillCard(b),{status:'failed',card:null});
    assert.equal((await s.db.query('SELECT skill_markdown FROM skill_results WHERE id=?1',[failed.id])).rows[0].skill_markdown,old);
    assert.equal((await s.db.query('SELECT count(*) AS n FROM skill_results')).rows[0].n,2);
  } finally {s.sqlite.close();}
});

for (const status of ['ready', 'failed']) for (const outcome of ['approved', 'provider failure', 'judge rejection', 'crash']) {
  test(`legacy ${status} video gets one refresh: ${outcome}`, async () => {
    const s = await setup();
    try {
      const unit = await s.unit('ready'), a = await s.artifact([unit]);
      const sql = async (parts: TemplateStringsArray, ...params: unknown[]) =>
        (await s.db.query(parts.reduce((text, part, i) => text + (i ? `?${i}` : '') + part, ''), params)).rows.map(decodeWebRow);
      const receipt = { ...(status === 'failed' ? { generator_revision: 'short-v1' } : {}), judge: 'short-judge-v1', passed: status === 'ready', captions_burned: true,
        scores: { grounding: 4, clarity: 4, usefulness: 4, visuals: 4, subtitles: 4 }, reasons: [] };
      const old = `videos/${a.id}/1/short.mp4`;
      await s.db.query(`INSERT INTO video_results(artifact_id,artifact_version,status,attempts,media_ref,caption_ref,narration_ref,
        duration_seconds,feed_order,review_status,review_feedback,opus_prompt_revision)
        VALUES(?1,1,?2,3,?3,'r2:captions/old.vtt','r2:audio/old.m4a',30,1,?4,?5,'script-v2')`,
        [a.id,status,`r2:${old}`,status === 'ready' ? 'approved' : 'rejected',JSON.stringify(receipt)]);
      const replacement: RenderedVideo = { judgment: { ...receipt, judge: 'short-judge-v1', passed: true, captions_burned: true },
        script: { scenes: [] }, prompt_revision: 'script-v3-cited-scenes', media_ref: `r2:videos/${a.id}/1/replacement/short.mp4`,
        caption_ref: 'r2:captions/replacement/short.vtt', narration_ref: 'r2:audio/replacement/narration.m4a', duration_seconds: 31 };
      assert.equal((await s.outputs.artifactsNeeding('video',10)).length,1);
      const claims = await Promise.all([s.outputs.claim('video',a),s.outputs.claim('video',a)]);
      assert.equal(claims.filter(Boolean).length,1,'only one processor can spend the refresh');
      const claim = claims.find(Boolean)!;
      const visible = status === 'ready';
      for (const scope of [null,[unit]]) {
        const feed = await readFeed(sql,scope);
        assert.equal(feed.length,visible ? 1 : 0);
        if (visible) assert.equal(feed[0].video.url,`/media/${old}`);
      }
      assert.equal(await canReadMedia(sql,old,[unit]),visible);
      assert.equal((await s.db.query('SELECT attempts FROM video_results')).rows[0].attempts,4);
      await s.db.query("UPDATE video_results SET updated_at='2000-01-01T00:00:00Z'");
      assert.equal(await s.outputs.claim('video',a),null,'even a stale refresh cannot restart');
      assert.deepEqual(await s.outputs.artifactsNeeding('video',10),[]);
      if (outcome === 'crash') return;
      if (outcome === 'approved') {
        await s.outputs.finishVideo(claim,replacement);
        for (const scope of [null,[unit]]) assert.equal((await readFeed(sql,scope))[0].video.url,replacement.media_ref.replace('r2:','/media/'));
        assert.equal(await canReadMedia(sql,old,[unit]),false,'the serving pointer changes only at approval');
        assert.equal(await canReadMedia(sql,replacement.media_ref.slice(3),[unit]),true);
      } else {
        await assert.rejects(s.outputs.finishVideo(claim,{...replacement,judgment:{...replacement.judgment,passed:false}}),/quality judge/);
        const error = outcome === 'judge rejection' ? 'Quality judge rejected: unsupported claim' : 'R2 upload failed';
        assert.equal(await s.outputs.fail('video',claim,error),true);
        const row = (await s.db.query('SELECT * FROM video_results')).rows[0];
        assert.equal(row.status,status);
        assert.equal(row.media_ref,`r2:${old}`);
        assert.equal(row.error,error);
        assert.equal(row.attempts,4,'attempt count never resets');
        for (const scope of [null,[unit]]) assert.equal((await readFeed(sql,scope)).length,visible ? 1 : 0);
        assert.equal(await canReadMedia(sql,old,[unit]),visible);
      }
      await assert.rejects(s.outputs.finishVideo(claim,replacement),/taken over/);
      assert.equal(await s.outputs.fail('video',claim,'late failure'),false);
      await s.db.query("UPDATE video_results SET updated_at='2000-01-01T00:00:00Z'");
      assert.equal(await s.outputs.claim('video',a),null);
      assert.deepEqual(await s.outputs.artifactsNeeding('video',10),[]);
      assert.equal((await s.db.query('SELECT count(*) AS n FROM video_results')).rows[0].n,1,'stored row is retained');
    } finally { s.sqlite.close(); }
  });
}

test('legacy video refresh is bounded even when old review feedback is not an object', async () => {
  const s = await setup();
  try {
    for (const feedback of [null,'[]','null','"old review"','invalid json']) {
      const a = await s.artifact([await s.unit('ready')]);
      await s.db.query(`INSERT INTO video_results(artifact_id,artifact_version,status,media_ref,caption_ref,narration_ref,duration_seconds,review_feedback)
        VALUES(?1,1,'ready','r2:videos/old.mp4','r2:captions/old.vtt','r2:audio/old.m4a',30,?2)`,[a.id,feedback]);
      const claims = await Promise.all([s.outputs.claim('video',a),s.outputs.claim('video',a)]);
      assert.equal(claims.filter(Boolean).length,1);
      const claim = claims.find(Boolean)!;
      assert.equal(await s.outputs.fail('video',claim,'replacement failed'),true);
      assert.equal(await s.outputs.claim('video',a),null);
    }
    assert.deepEqual(await s.outputs.artifactsNeeding('video',10),[]);
  } finally { s.sqlite.close(); }
});
