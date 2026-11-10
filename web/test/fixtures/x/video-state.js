// Local test entry only. These persist synthetic QA states; production never imports this module.
import { SKILL_PROMPT_REVISION } from '../../../src/skill-policy.js';

export async function videoState(request,env,user) {
  if (!user) return Response.json({error:'Sign in to the isolated fixture.'},{status:401});
  const {state}=await request.json();
  const run=(sql,...params)=>env.DB.prepare(sql).bind(...params).run();
  if(state==='prepare') {
    for(const [i,name] of ['Check changes before shipping','Keep the source with the skill'].entries()) {
      const source=`https://x.com/i/status/${2111437891322745223n+BigInt(i)}`;
      const unit=await env.DB.prepare("INSERT INTO ingested_units(submitted_url,source_url,status,transcript,title) VALUES(?,?,'ready','{}',?) RETURNING id").bind(source,source,name).first();
      await run('INSERT INTO user_imports(user_id,unit_id) VALUES(?,?)',user.id,unit.id);
      const a=await env.DB.prepare("INSERT INTO artifacts(name,source_url,source_ids,processed_text,ingestion_status) VALUES(?,?,?,'Use the saved source to check a change.','ready') RETURNING id").bind(name,source,JSON.stringify([unit.id])).first();
      await run("INSERT INTO skill_results(artifact_id,artifact_version,status,skill_markdown,review_feedback) VALUES(?,1,'ready',?,?)",a.id,`---\nname: ${i?'source-linked-skill':'check-before-shipping'}\ndescription: ${i?'Keep source links alongside the procedure.':'Run the relevant checks before publishing a change.'}\n---\n\nRead the saved source and run the relevant checks.\n\n## Sources\n\n- ${source}\n`,JSON.stringify({prompt_revision:SKILL_PROMPT_REVISION}));
    }
    return Response.json({prepared:true});
  }
  if(state==='reset-budget') {
    await run("DELETE FROM users WHERE email LIKE 'local-video-budget-%@example.test'");
    return Response.json({reset:true});
  }
  const a=await env.DB.prepare(`SELECT a.id,a.version FROM artifacts a
    WHERE json_array_length(a.source_ids)>0 AND NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) src
      WHERE NOT EXISTS (SELECT 1 FROM user_imports ui WHERE ui.user_id=? AND ui.unit_id=src.value))
    ORDER BY a.created_at,a.id LIMIT 1`).bind(user.id).first();
  if(!a) return Response.json({error:'Prepare a test skill first.'},{status:409});
  if(state==='daily-limit') {
    for(let i=0;i<20;i++) {
      const id=`local-video-budget-${i}`;
      await run("INSERT OR IGNORE INTO users(id,email,password_hash) VALUES(?,?,'isolated-fixture')",id,`${id}@example.test`);
      await run('INSERT OR IGNORE INTO user_imports(user_id,unit_id) SELECT ?,value FROM artifacts,json_each(artifacts.source_ids) WHERE artifacts.id=? AND artifacts.version=?',id,a.id,a.version);
      await run('INSERT OR IGNORE INTO user_video_requests(user_id,artifact_id,artifact_version) VALUES(?,?,?)',id,a.id,a.version);
    }
    return Response.json({limited:true});
  }
  if(!['failed','ready'].includes(state)) return Response.json({error:'Unknown test state.'},{status:400});
  const slot=await env.DB.prepare('SELECT artifact_id AS id,artifact_version AS version FROM user_video_requests WHERE user_id=?').bind(user.id).first();
  if(!slot) return Response.json({error:'Request your video first.'},{status:409});
  await run(`INSERT INTO video_results(artifact_id,artifact_version,status,attempts,media_ref,caption_ref,narration_ref,duration_seconds,review_status,review_feedback,error)
    VALUES(?,?,?,3,?,?,?,25,'approved',?,?) ON CONFLICT(artifact_id,artifact_version) DO UPDATE SET
      status=excluded.status,attempts=excluded.attempts,media_ref=excluded.media_ref,caption_ref=excluded.caption_ref,narration_ref=excluded.narration_ref,
      duration_seconds=excluded.duration_seconds,review_status=excluded.review_status,review_feedback=excluded.review_feedback,error=excluded.error`,
    slot.id,slot.version,state,'r2:videos/fixture/short.mp4','r2:captions/fixture/captions.vtt','r2:audio/fixture/narration.m4a',
    JSON.stringify({judge:'short-judge-v1',passed:true,captions_burned:true,fixture:true}),state==='failed'?'OpenAI HTTP 503: isolated QA failure':null);
  return Response.json({state});
}
