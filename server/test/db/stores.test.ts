import { publicationJudgment } from "../../src/outputs/render/judge.js";
import { approvedJudgment } from "../outputs/helpers.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers.js';
import { D1Store } from '../../src/ingest/store.js';
import { D1OutputStore } from '../../src/outputs/store.js';
import { D1HandoffStore } from '../../src/outputs/handoff-store.js';
import { saveUsage } from '../../src/usage.js';
import { processUnits, sweepOnce } from '../../src/ingest/processor.js';
import { mockFetch } from '../ingest/helpers.js';
import { UNLIMITED } from '../../src/ingest/limits.js';
import { DEFAULT_CATEGORIZATION_REQUEST, promptRevisionText } from '../../src/ingest/digest/prompt.js';
import { SKILL_PROMPT_REVISION } from '../../src/outputs/skills.js';
import { readFeed, canReadMedia } from '../../../web/src/feed.js';
import { readVideoRequest, reserveVideo } from '../../../web/src/video-requests.js';
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
  const videoOwners=new Map<string,string>();
  async function artifact(ids: string[]) {
    const a = (await store.saveArtifacts([{ name:'Check first',source_ids:ids,category:'Evals',processed_text:'content',selection_reason:'reason',evidence:[] }],[],prompt))[0];
    await db.query('INSERT INTO user_skill_choices(user_id,artifact_id,artifact_version,kept,video_requested) VALUES(?1,?2,?3,1,1) ON CONFLICT DO NOTHING',[user,a.id,a.version]);
    // Independent video fixtures use independent accounts; duplicate artifacts reuse their owner.
    let videoOwner=videoOwners.get(a.id);
    if (!videoOwner) {
      videoOwner=videoOwners.size===0 ? user : randomUUID();
      videoOwners.set(a.id,videoOwner);
      if (videoOwner!==user) {
        await db.query("INSERT INTO users(id,email,password_hash) VALUES(?1,?2,'test')",[videoOwner,`video-${videoOwner}@example.test`]);
        await db.query('INSERT INTO user_imports(user_id,unit_id) SELECT ?1,id FROM ingested_units WHERE id IN (SELECT value FROM json_each(?2))',[videoOwner,JSON.stringify(ids)]);
        await db.query('INSERT INTO user_skill_choices(user_id,artifact_id,artifact_version,kept,video_requested) VALUES(?1,?2,?3,1,1)',[videoOwner,a.id,a.version]);
      }
    }
    await db.query('INSERT INTO user_video_requests(user_id,artifact_id,artifact_version) VALUES(?1,?2,?3) ON CONFLICT DO NOTHING',[videoOwner,a.id,a.version]);
    return a;
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
    const rendered={judgment:approvedJudgment(),script:{scenes:[]},prompt_revision:'script-v1',media_ref:`r2:videos/${a.id}/1/short.mp4`,caption_ref:`r2:captions/${a.id}/1/short.vtt`,narration_ref:`r2:audio/${a.id}/1/narration.m4a`,duration_seconds:34.5,music_provenance:'Licensed test provenance'};
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

test('a judge rejection releases the one video reservation so the account can request another skill',async()=>{
  const s=await setup();
  try {
    const sql = async (parts: TemplateStringsArray, ...params: unknown[]) =>
      (await s.db.query(parts.reduce((text, part, i) => text + (i ? `?${i}` : '') + part, ''), params)).rows.map(decodeWebRow);
    const env={SHORTS:'on'};
    const rejected=await s.artifact([await s.unit('ready')]);
    const other=(await s.store.saveArtifacts([{ name:'Second skill',source_ids:[await s.unit('ready')],category:'Evals',processed_text:'other',selection_reason:'reason',evidence:[] }],[],s.prompt))[0];
    assert.equal((await readVideoRequest(sql,s.user,env))?.status,'queued');
    const claim=(await s.outputs.claim('video',rejected))!;
    assert.equal(await s.outputs.fail('video',claim,'Quality judge rejected: unsupported claim'),true);
    assert.equal(await readVideoRequest(sql,s.user,env),null);
    assert.equal(await s.outputs.videoRequested(rejected),false);
    assert.equal((await sql`SELECT video_requested FROM user_skill_choices WHERE artifact_id=${rejected.id}`)[0].video_requested,0);
    const again=await reserveVideo(sql,s.user,{id:rejected.id,version:rejected.version},env);
    assert.equal(again.status,409);
    assert.match(again.error,/couldn't be made/);
    const reserved=await reserveVideo(sql,s.user,{id:other.id,version:other.version},env);
    assert.equal(reserved.error,undefined);
    assert.deepEqual(reserved.video.artifact,{id:other.id,version:other.version});
  } finally {s.sqlite.close();}
});

test('a second judge rejection for the same account keeps its video slot used and shows failed',async()=>{
  const s=await setup();
  try {
    const sql = async (parts: TemplateStringsArray, ...params: unknown[]) =>
      (await s.db.query(parts.reduce((text, part, i) => text + (i ? `?${i}` : '') + part, ''), params)).rows.map(decodeWebRow);
    const env={SHORTS:'on'};
    const first=await s.artifact([await s.unit('ready')]);
    const next=async(name:string)=>(await s.store.saveArtifacts([{ name,source_ids:[await s.unit('ready')],category:'Evals',processed_text:name,selection_reason:'reason',evidence:[] }],[],s.prompt))[0];
    const second=await next('Second skill');
    const third=await next('Third skill');
    const claimFirst=(await s.outputs.claim('video',first))!;
    assert.equal(await s.outputs.fail('video',claimFirst,'Quality judge rejected: unsupported claim'),true);
    assert.equal(await readVideoRequest(sql,s.user,env),null);

    assert.equal((await reserveVideo(sql,s.user,{id:second.id,version:second.version},env)).error,undefined);
    await s.db.query('INSERT INTO user_skill_choices(user_id,artifact_id,artifact_version,kept,video_requested) VALUES(?1,?2,?3,1,1)',[s.user,second.id,second.version]);
    const claimSecond=(await s.outputs.claim('video',second))!;
    assert.equal(await s.outputs.fail('video',claimSecond,'Quality judge rejected: unsupported claim'),true);

    const video=await readVideoRequest(sql,s.user,env);
    assert.equal(video.status,'failed');
    assert.deepEqual(video.artifact,{id:second.id,version:second.version});
    assert.equal((await s.db.query('SELECT count(*) AS n FROM user_video_requests')).rows[0].n,1);
    assert.equal(await s.outputs.videoRequested(second),true);

    const blocked=await reserveVideo(sql,s.user,{id:third.id,version:third.version},env);
    assert.equal(blocked.status,409);
    assert.equal(blocked.code,'video_already_requested');
  } finally {s.sqlite.close();}
});

test('a provider failure keeps the video reservation for its retries',async()=>{
  const s=await setup();
  try {
    const a=await s.artifact([await s.unit('ready')]);
    const claim=(await s.outputs.claim('video',a))!;
    assert.equal(await s.outputs.fail('video',claim,'R2 upload failed',undefined,true),true);
    assert.equal(await s.outputs.videoRequested(a),true);
    assert.equal((await s.db.query('SELECT count(*) AS n FROM user_video_requests')).rows[0].n,1);
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
        scores: { grounding: 4, clarity: 4, usefulness: 4, visuals: 4, subtitles: 4, caption_overlap: 4 }, reasons: [] };
      const old = `videos/${a.id}/1/short.mp4`;
      await s.db.query(`INSERT INTO video_results(artifact_id,artifact_version,status,attempts,media_ref,caption_ref,narration_ref,
        duration_seconds,feed_order,review_status,review_feedback,opus_prompt_revision)
        VALUES(?1,1,?2,3,?3,'r2:captions/old.vtt','r2:audio/old.m4a',30,1,?4,?5,'script-v2')`,
        [a.id,status,`r2:${old}`,status === 'ready' ? 'approved' : 'rejected',JSON.stringify(receipt)]);
      const replacement: RenderedVideo = { judgment: approvedJudgment(),
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
      if (outcome === 'crash') {
        await s.db.query("UPDATE video_results SET updated_at='2000-01-01T00:00:00Z'");
        assert.equal(await s.outputs.claim('video',a),null,'even a stale refresh cannot restart');
        assert.deepEqual(await s.outputs.artifactsNeeding('video',10),[]);
        const settled = (await s.db.query('SELECT status,error FROM video_results')).rows[0];
        assert.equal(settled.status, status === 'ready' ? 'ready' : 'failed');
        if (status === 'failed') assert.equal(settled.error,'stopped responding after the maximum attempts');
        return;
      }
      if (outcome === 'approved') {
        await s.outputs.finishVideo(claim,replacement);
        for (const scope of [null,[unit]]) assert.equal((await readFeed(sql,scope))[0].video.url,replacement.media_ref.replace('r2:','/media/'));
        assert.equal(await canReadMedia(sql,old,[unit]),false,'the serving pointer changes only at approval');
        assert.equal(await canReadMedia(sql,replacement.media_ref.slice(3),[unit]),true);
      } else {
        await assert.rejects(s.outputs.finishVideo(claim,{...replacement,judgment:{...replacement.judgment,passed:false}}),/quality judge/);
        const error = outcome === 'judge rejection' ? 'Quality judge rejected: unsupported claim' : 'R2 upload failed';
        const reviewed = approvedJudgment();
        reviewed.reviews[1].scores.grounding = 2;
        const rejected = publicationJudgment(reviewed.reviews, [], reviewed.cue_checks);
        const attemptReview = outcome === 'judge rejection' ? rejected : approvedJudgment();
        assert.equal(await s.outputs.fail('video',claim,error,attemptReview),true);
        const row = (await s.db.query('SELECT * FROM video_results')).rows[0];
        assert.equal(row.status,status);
        assert.equal(row.media_ref,`r2:${old}`);
        assert.equal(row.error,error);
        {
          const saved = JSON.parse(row.review_feedback);
          assert.deepEqual(saved.last_rejected_review, attemptReview);
          assert.equal(saved.passed, receipt.passed, "prior publication receipt is retained");
          assert.ok(saved.last_rejected_review.review_log.length > 2000, "full receipts survive beyond the error limit");
        }
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

test('D1 infrastructure failures retain completed critiques without exhausting ordinary retries', async () => {
  const s = await setup();
  try {
    const a = await s.artifact([await s.unit('ready')]);
    const claim = (await s.outputs.claim('video', a))!;
    const review = approvedJudgment();
    assert.equal(await s.outputs.fail('video', claim, 'R2 HTTP 503: temporarily unavailable', review), true);
    const row = (await s.db.query('SELECT * FROM video_results WHERE id=?1', [claim.id])).rows[0];
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 1);
    assert.equal(row.error, 'R2 HTTP 503: temporarily unavailable');
    assert.deepEqual(JSON.parse(row.review_feedback).last_rejected_review, review);
    assert.equal(await s.outputs.claim('video', a), null, 'normal backoff still applies');
    await s.db.query("UPDATE video_results SET updated_at='2000-01-01T00:00:00Z' WHERE id=?1", [claim.id]);
    assert.ok(await s.outputs.claim('video', a), 'a transient error still gets an ordinary retry');
    assert.equal((await s.db.query('SELECT attempts FROM video_results WHERE id=?1', [claim.id])).rows[0].attempts, 2);
  } finally { s.sqlite.close(); }
});

test('a new import is queued before older retries and refreshes', async () => {
  const s = await setup();
  try {
    const old = await s.artifact([await s.unit('ready')]);
    await s.db.query(`INSERT INTO video_results(artifact_id,artifact_version,status,attempts,review_feedback,updated_at)
      VALUES(?1,1,'failed',1,'{}','2000-01-01T00:00:00Z')`, [old.id]);
    const fresh = await s.artifact([await s.unit('ready')]);
    assert.deepEqual((await s.outputs.artifactsNeeding('video', 10)).map((a) => a.id), [fresh.id, old.id]);
  } finally { s.sqlite.close(); }
});

test('usage records land in usage_events',async()=>{
  const s=await setup();
  try {
    await saveUsage(s.db,{step:'judge',provider:'openai',model:'gpt-6.1-sol',input_tokens:63768,output_tokens:3533,reasoning_tokens:1552,ref:'artifact-1'});
    assert.deepEqual({...(await s.db.query('SELECT step,model,input_tokens,output_tokens,ref FROM usage_events')).rows[0]},
      {step:'judge',model:'gpt-6.1-sol',input_tokens:63768,output_tokens:3533,ref:'artifact-1'});
  } finally {s.sqlite.close();}
});


test('video opt-in gates direct claims, stale retries and sweep eligibility', async()=>{
  const s=await setup();
  try {
    const id=await s.unit('ready'),a=await s.artifact([id]);
    await s.db.query('DELETE FROM user_skill_choices');
    assert.equal(await s.outputs.videoRequested(a),false);
    assert.deepEqual(await s.outputs.artifactsNeeding('video',10),[]);
    assert.equal(await s.outputs.claim('video',a),null);
    await s.db.query('INSERT INTO user_skill_choices(user_id,artifact_id,artifact_version,kept,video_requested) VALUES(?1,?2,?3,1,0)',[s.user,a.id,a.version]);
    assert.equal(await s.outputs.claim('video',a),null);
    await s.db.query('UPDATE user_skill_choices SET video_requested=1');
    assert.equal((await s.outputs.artifactsNeeding('video',10)).length,1);
    const claim=await s.outputs.claim('video',a);
    assert.ok(claim);
    await s.outputs.fail('video',claim,'temporary provider failure');
    await s.db.query("UPDATE video_results SET updated_at='2000-01-01'");
    await s.db.query('UPDATE user_skill_choices SET kept=0,video_requested=0');
    assert.equal(await s.outputs.claim('video',a),null);
    assert.deepEqual(await s.outputs.artifactsNeeding('video',10),[]);
    await s.db.query('UPDATE user_skill_choices SET kept=1,video_requested=1');
    await s.db.query('DELETE FROM user_imports');
    assert.equal(await s.outputs.claim('video',a),null,'removed source access revokes eligibility');
  } finally {s.sqlite.close();}
});

for (const limits of [{daily:1,monthly:10},{daily:10,monthly:1}]) {
  test(`output retries share the last daily/monthly slot atomically (${JSON.stringify(limits)})`,async()=>{
    const s=await setup();
    try {
      const artifacts=await Promise.all([s.unit('ready'),s.unit('ready')].map(async id=>s.artifact([await id])));
      const claims=await Promise.all(artifacts.map(a=>s.outputs.claim('skill',a,{daily:0,monthly:0})));
      assert.ok(claims.every(Boolean),'first output attempts are covered by their digest');
      for (const c of claims) await s.outputs.fail('skill',c!,'OpenAI HTTP 500: unavailable');
      await s.db.query("UPDATE skill_results SET updated_at='2000-01-01'");
      assert.equal(await s.outputs.claim('skill',artifacts[0],{daily:0,monthly:0}),null);
      assert.deepEqual((await s.db.query('SELECT attempts FROM skill_results')).rows.map(r=>r.attempts),[1,1]);
      const attempts=await Promise.all([
        s.outputs.claim('skill',artifacts[0],limits),
        s.outputs.claim('skill',artifacts[0],limits),
        s.outputs.claim('skill',artifacts[1],limits),
      ]);
      assert.equal(attempts.filter(Boolean).length,1,'one worker takes the last slot');
      const starts=(await s.db.query('SELECT kind,charged,unit_id FROM processing_starts')).rows;
      assert.equal(starts.length,1);
      assert.equal(starts[0].kind,'retry');
      assert.equal(starts[0].charged,1);
      assert.equal(starts[0].unit_id,artifacts[0].source_ids[0]);
      const fresh=await s.artifact([await s.unit('ready')]);
      assert.equal((await s.outputs.artifactsNeeding('skill',1))[0].id,fresh.id,'blocked retries cannot hide fresh work');
      assert.ok(await s.outputs.claim('skill',fresh,limits),'fresh work still runs with exhausted retry budget');
      assert.equal((await s.db.query('SELECT count(*) AS n FROM processing_starts')).rows[0].n,1);
    } finally {s.sqlite.close();}
  });
}

test('stale output claims and versioned refreshes are charged, and unchargeable retries fail closed',async()=>{
  const s=await setup();
  try {
    const a=await s.artifact([await s.unit('ready')]);
    const claim=(await s.outputs.claim('video',a))!;
    await s.db.query("UPDATE video_results SET updated_at='2000-01-01'");
    assert.equal(await s.outputs.claim('video',a,{daily:0,monthly:0}),null);
    const takeover=(await s.outputs.claim('video',a,{daily:2,monthly:2}))!;
    assert.ok(takeover);
    assert.notEqual(takeover.token,claim.token);
    assert.equal(await s.outputs.fail('video',claim,'late failure'),false);
    await s.outputs.fail('video',takeover,'temporary failure');
    await s.db.query("UPDATE video_results SET review_feedback='{}',updated_at='2000-01-01'");
    assert.equal(await s.outputs.claim('video',a,{daily:2,monthly:2}),null,'first attempts and takeover already used two video starts');
    assert.ok(await s.outputs.claim('video',a,{daily:3,monthly:3}));
    assert.equal((await s.db.query("SELECT count(*) AS n FROM processing_starts WHERE kind='retry' AND charged=1")).rows[0].n,2);
    const orphan=await s.artifact([randomUUID()]);
    const first=(await s.outputs.claim('skill',orphan))!;
    await s.outputs.fail('skill',first,'temporary failure');
    await s.db.query("UPDATE skill_results SET updated_at='2000-01-01'");
    assert.equal(await s.outputs.claim('skill',orphan,UNLIMITED),null,'no paid retry without a source to charge');
  } finally {s.sqlite.close();}
});

test('permanent output failure settles D1 attempts while preserving full review receipts',async()=>{
  const s=await setup();
  try {
    const a=await s.artifact([await s.unit('ready')]);
    const claim=(await s.outputs.claim('video',a))!;
    const review=approvedJudgment();
    assert.equal(await s.outputs.fail('video',claim,'TTS HTTP 402: credits depleted',review,true),true);
    const row=(await s.db.query('SELECT * FROM video_results')).rows[0];
    assert.equal(row.attempts,3);
    assert.deepEqual(JSON.parse(row.review_feedback).last_rejected_review,review);
    await s.db.query("UPDATE video_results SET updated_at='2000-01-01'");
    assert.equal(await s.outputs.claim('video',a),null);
  } finally {s.sqlite.close();}
});

for (const limits of [{daily:20,monthly:400},{daily:20,monthly:2}]) {
  test(`all video claims reserve daily/monthly slots atomically (${JSON.stringify(limits)})`,async()=>{
    const s=await setup();
    try {
      const artifacts=[];
      for(let i=0;i<23;i++) {
        const a=await s.artifact([await s.unit('ready')]);
        const user=(await s.db.query("INSERT INTO users(email,password_hash) VALUES(?1,'test') RETURNING id",[`video-${i}@example.test`])).rows[0].id;
        await s.db.query('INSERT INTO user_imports(user_id,unit_id) VALUES(?1,?2)',[user,a.source_ids[0]]);
        await s.db.query('INSERT INTO user_skill_choices(user_id,artifact_id,artifact_version,kept,video_requested) VALUES(?1,?2,?3,1,1)',[user,a.id,a.version]);
        await s.db.query('INSERT INTO user_video_requests(user_id,artifact_id,artifact_version) VALUES(?1,?2,?3)',[user,a.id,a.version]);
        artifacts.push(a);
      }
      const claims=await Promise.all(artifacts.map(a=>s.outputs.claim('video',a,limits)));
      assert.equal(claims.filter(Boolean).length,Math.min(limits.daily,limits.monthly));
      assert.equal((await s.db.query('SELECT count(*) AS n FROM video_starts')).rows[0].n,Math.min(limits.daily,limits.monthly));
      await s.outputs.fail('video',claims[0]!,'temporary provider error');
      await s.db.query("UPDATE video_results SET updated_at='2000-01-01' WHERE id=?1",[claims[0]!.id]);
      assert.equal(await s.outputs.claim('video',artifacts[0],limits),null,'retries cannot bypass the video start cap');
      await s.db.query("UPDATE video_starts SET created_at='2000-01-01'");
      assert.ok(await s.outputs.claim('video',artifacts[0],limits),'the same video can retry after the budget resets');
    } finally {s.sqlite.close();}
  });
}

test('a render that keeps crashing while holding its claim is reclaimed only up to the output attempt limit',async()=>{
  const s=await setup();
  try {
    const a=await s.artifact([await s.unit('ready')]);
    const reclaimed:boolean[]=[];
    for (let crash=0;crash<6;crash++) {
      reclaimed.push(await s.outputs.claim('skill',a,UNLIMITED)!==null);
      await s.db.query("UPDATE skill_results SET updated_at='2000-01-01'");
    }
    assert.equal(reclaimed.filter(Boolean).length,3);
    assert.equal((await s.db.query('SELECT attempts FROM skill_results')).rows[0].attempts,3);
    await s.outputs.artifactsNeeding('skill',50);
    const row=(await s.db.query('SELECT status,error FROM skill_results')).rows[0];
    assert.equal(row.status,'failed','an exhausted claim is settled, not left running');
    assert.equal(row.error,'stopped responding after the maximum attempts');
    assert.equal(await s.outputs.claim('skill',a,UNLIMITED),null);
  } finally {s.sqlite.close();}
});

test('a skill regeneration that dies while holding its claim is settled as failed, not left running',async()=>{
  const s=await setup();
  try {
    const a=await s.artifact([await s.unit('ready')]);
    const first=(await s.outputs.claim('skill',a,UNLIMITED))!;
    await s.outputs.finishSkill(first,{skill_markdown:'---\nname: check-first\ndescription: d\n---',supporting_refs:[],action_items:[]});
    await s.db.query(`UPDATE skill_results SET review_feedback='{"prompt_revision":"stale"}'`);
    assert.ok(await s.outputs.claim('skill',a,UNLIMITED));
    assert.equal((await s.db.query('SELECT status FROM skill_results')).rows[0].status,'running');
    await s.db.query("UPDATE skill_results SET updated_at='2000-01-01'");
    await s.outputs.artifactsNeeding('skill',50);
    const row=(await s.db.query('SELECT status,error,attempts FROM skill_results')).rows[0];
    assert.equal(row.status,'failed');
    assert.equal(row.error,'stopped responding after the maximum attempts');
    assert.equal(row.attempts,3);
    await s.db.query("UPDATE skill_results SET updated_at='2000-01-01'");
    assert.equal(await s.outputs.claim('skill',a,UNLIMITED),null);
  } finally {s.sqlite.close();}
});

test('an extraction that keeps dying while holding its claim is reclaimed only up to the extraction attempt limit',async()=>{
  const s=await setup();
  try {
    const id=await s.unit();
    const claimed:number[]=[];
    for (let crash=0;crash<6;crash++) {
      claimed.push((await s.store.claimWithinLimits([id],UNLIMITED)).claimed.length);
      await s.db.query("UPDATE ingested_units SET claimed_at='2000-01-01'");
    }
    assert.equal(claimed.reduce((n,c)=>n+c,0),3);
    assert.equal((await s.db.query("SELECT count(*) AS n FROM processing_starts WHERE unit_id=?1 AND kind='extract'",[id])).rows[0].n,3);
    await s.store.listPendingUnitIds(10);
    const unit=(await s.store.getUnits([id]))[0];
    assert.equal(unit.status,'failed','an exhausted extraction is settled, not left running');
    assert.equal(unit.error,'stopped responding after the maximum attempts');
  } finally {s.sqlite.close();}
});

test('a heartbeat keeps a long-running output or extraction claim from being taken over',async()=>{
  const s=await setup();
  try {
    const a=await s.artifact([await s.unit('ready')]);
    const output=(await s.outputs.claim('skill',a,UNLIMITED))!;
    await s.db.query("UPDATE skill_results SET updated_at='2000-01-01'");
    assert.equal(await s.outputs.heartbeat('skill',output),true);
    assert.equal(await s.outputs.claim('skill',a,UNLIMITED),null,'a beating output claim is not stale');
    await s.outputs.fail('skill',output,'done');
    assert.equal(await s.outputs.heartbeat('skill',output),false,'a released claim cannot be refreshed');

    const id=await s.unit();
    await s.store.claimWithinLimits([id],UNLIMITED);
    await s.db.query("UPDATE ingested_units SET claimed_at='2000-01-01'");
    await s.store.heartbeat([id]);
    assert.deepEqual((await s.store.claimWithinLimits([id],UNLIMITED)).claimed,[],'a beating extraction is not stale');
  } finally {s.sqlite.close();}
});
