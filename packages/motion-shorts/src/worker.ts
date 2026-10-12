import pg from 'pg';
import path from 'node:path';
import {access,readFile} from 'node:fs/promises';
import {adaptIngestionArtifact,mediaObjectKeys} from './ingestion';
import {Pipeline,safeError} from './jobs';
import {LocalStore} from './storage';
import {createProvider,PROMPT_VERSION} from './provider';
import {productionConfig} from './renderer';
import {createMediaUploader,verifyDeliverable,type MediaUploader} from './delivery';
import {generateNarration} from './narration';
import type {Technique} from './contracts';
import {planSchema} from './contracts';
import {synthesizeMusic} from './music';
import {renderFastShort,FAST_REVISION} from './fast-video';
import {renderEditorialShort} from './editorial-video';
import {EDITORIAL_REVISION} from './editorial-plan';

const currentVideoRevision=()=>process.env.MOTION_GENERATION_MODE==='fast'?FAST_REVISION:EDITORIAL_REVISION;

export type ReadyVideo={media_ref:string;caption_ref:string;narration_ref:string;music_ref:string;music_provenance:string;duration_seconds:number;script:unknown;promptRevision?:string};
export type BuildVideo=(input:Technique)=>Promise<ReadyVideo>;

// Session advisory locks cover the entire generation/upload operation without
// holding a long transaction. A crashed worker releases its lock on disconnect.
export async function processArtifact(client:pg.PoolClient,id:string,version:number,build:BuildVideo,retryFailed=false,refreshReady=false){
  let connectionError:Error|undefined;
  const onError=(error:Error)=>{connectionError=error;};
  client.on?.('error',onError);
  // Rendering is CPU/network work outside SQL. Keep its lock-owning session
  // alive, and refuse to publish if that session (and therefore its lock) dies.
  const heartbeat=setInterval(()=>{
    if(!connectionError)void client.query('SELECT 1').catch(onError);
  },20000);
  heartbeat.unref();
  try{return await processLockedArtifact(client,id,version,async input=>{
    const video=await build(input);
    if(connectionError)throw connectionError;
    return video;
  },retryFailed,refreshReady);}
  finally{clearInterval(heartbeat);client.removeListener?.('error',onError);}
}

async function processLockedArtifact(client:pg.PoolClient,id:string,version:number,build:BuildVideo,retryFailed=false,refreshReady=false){
  const lock=`motion:${id}:${version}`;
  const acquired=await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[lock]);
  if(!acquired.rows[0]?.locked)return 'busy';
  let resultId:string|undefined;
  let preserveReady=false;
  try{
    const prior=await client.query('SELECT id,status,opus_prompt_revision FROM video_results WHERE artifact_id=$1 AND artifact_version=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[id,version]);
    preserveReady=prior.rows[0]?.status==='ready';
    if(preserveReady&&(!refreshReady||prior.rows[0]?.opus_prompt_revision===currentVideoRevision()))return 'ready';
    if(prior.rows[0]?.status==='failed'&&!retryFailed)return 'failed';
    const artifact=(await client.query("SELECT * FROM artifacts WHERE id=$1 AND version=$2 AND ingestion_status='ready'",[id,version])).rows[0];
    if(!artifact)return 'not_ready';
    resultId=prior.rows[0]?.id;
    if(resultId&&!preserveReady)await client.query("UPDATE video_results SET status='running',error=NULL,updated_at=now() WHERE id=$1",[resultId]);
    else if(!resultId)resultId=(await client.query("INSERT INTO video_results (artifact_id,artifact_version,project_context_version,status,opus_prompt_revision) VALUES ($1,$2,$3,'running',$4) RETURNING id",[id,version,artifact.project_context_version,PROMPT_VERSION])).rows[0].id;
    const units=(await client.query('SELECT id,source_url,title,status FROM ingested_units WHERE id=ANY($1::uuid[])',[artifact.source_ids])).rows;
    const input=adaptIngestionArtifact({artifact,units});
    const completed=await build(input);
    // Re-check readiness before exposing results, even if an operator changed it
    // during rendering. Version immutability is enforced by migration 004.
    const saved=await client.query(`UPDATE video_results SET status='ready',media_ref=$2,caption_ref=$3,narration_ref=$4,music_ref=$5,music_provenance=$6,duration_seconds=$7,script=$8,opus_prompt_revision=COALESCE($11,opus_prompt_revision),error=NULL,updated_at=now()
      WHERE id=$1 AND EXISTS (SELECT 1 FROM artifacts WHERE id=$9 AND version=$10 AND ingestion_status='ready') RETURNING id`,
    [resultId,completed.media_ref,completed.caption_ref,completed.narration_ref,completed.music_ref,completed.music_provenance,completed.duration_seconds,JSON.stringify(completed.script),id,version,completed.promptRevision??null]);
    if(!saved.rowCount)throw new Error('Artifact is no longer ready');
    return 'ready';
  }catch(e){
    if(resultId&&!preserveReady)await client.query("UPDATE video_results SET status='failed',error=$2,updated_at=now() WHERE id=$1",[resultId,safeError(e)]);
    throw e;
  }finally{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]);}
}

export function createVideoBuilder(pipeline:Pipeline,uploader:MediaUploader,music?:string,musicProvenance?:string):BuildVideo{
  return async input=>{
    if(process.env.MOTION_GENERATION_MODE==='fast')return {...await renderFastShort(input,pipeline.store.root,uploader),promptRevision:FAST_REVISION};
    if(process.env.MOTION_GENERATION_MODE!=='creative')return renderEditorialShort(input,pipeline.store.root,uploader);
    const job=await pipeline.create(input,productionConfig);
    const dir=pipeline.store.directory(job.id);
    await pipeline.generate(job.id,createProvider());
    const narration=await generateNarration(dir);
    const plan=planSchema.parse(JSON.parse(await readFile(path.join(dir,'animation.json'),'utf8')));
    const bed=music?{file:music,provenance:musicProvenance!}:await synthesizeMusic(path.join(dir,'generated-music.wav'),plan.duration);
    const rendered=await pipeline.render(job.id,{narration:narration.file,music:bed.file,musicProvenance:bed.provenance,voiceProvenance:narration.provenance});
    await verifyDeliverable(rendered,path.join(dir,'video.mp4'));
    const keys=mediaObjectKeys(input);
    const root=`videos/${input.id}/${input.version}`;
    const media_ref=await uploader.upload(path.join(dir,'video.mp4'),keys.video,'video/mp4');
    const caption_ref=await uploader.upload(path.join(dir,'captions.vtt'),keys.captions,'text/vtt');
    const narration_ref=await uploader.upload(narration.file,`${root}/narration.wav`,'audio/wav');
    const music_ref=await uploader.upload(path.join(dir,'music.audio'),`${root}/music.audio`,'application/octet-stream');
    return {media_ref,caption_ref,narration_ref,music_ref,music_provenance:bed.provenance,duration_seconds:rendered.qa!.duration,script:JSON.parse(await readFile(path.join(dir,'script.json'),'utf8'))};
  };
}

export async function runWorker(options:{once?:boolean;retryFailed?:boolean;refreshReady?:boolean;store?:string}={}){
  if(options.refreshReady&&(!options.once||process.env.MOTION_GENERATION_MODE==='creative'))throw new Error('Ready refresh requires --once and editorial or fast generation mode');
  for(const key of ['DATABASE_URL','OPENAI_API_KEY'])if(!process.env[key]?.trim())throw new Error(`${key} is missing`);
  const music=process.env.MOTION_MUSIC_FILE?path.resolve(process.env.MOTION_MUSIC_FILE):undefined;
  if(music){await access(music);if(!process.env.MOTION_MUSIC_PROVENANCE?.trim())throw new Error('MOTION_MUSIC_PROVENANCE is required with custom music');}
  const uploader=createMediaUploader();
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:10000,keepAlive:true,maxLifetimeSeconds:120});
  pool.on('error',error=>console.error(JSON.stringify({event:'database_idle_connection_error',error:safeError(error)})));
  const build=createVideoBuilder(new Pipeline(new LocalStore(options.store)),uploader,music,process.env.MOTION_MUSIC_PROVENANCE);
  let stopped=false;const stop=()=>{stopped=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    // Refuse to run before immutable revisions are installed.
    const trigger=await pool.query("SELECT 1 FROM pg_trigger WHERE tgname='artifacts_freeze_ready_revision' AND NOT tgisinternal");
    if(!trigger.rowCount)throw new Error('Apply migration 004_artifact_revisions.sql before starting the video worker');
    do{
      const candidates=await pool.query(`SELECT a.id,a.version FROM artifacts a LEFT JOIN LATERAL
        (SELECT status,opus_prompt_revision FROM video_results WHERE artifact_id=a.id AND artifact_version=a.version ORDER BY created_at DESC,id DESC LIMIT 1) v ON true
        WHERE a.ingestion_status='ready' AND (v.status IS NULL OR v.status IN ('pending','running') OR ($1 AND v.status='failed') OR ($2 AND v.status='ready' AND v.opus_prompt_revision IS DISTINCT FROM $3)) ORDER BY a.created_at DESC,a.id LIMIT 10`,[!!options.retryFailed,!!options.refreshReady,currentVideoRevision()]);
      for(const candidate of candidates.rows){
        if(stopped)break;const client=await pool.connect();
        try{const status=await processArtifact(client,candidate.id,candidate.version,build,options.retryFailed,options.refreshReady);console.log(JSON.stringify({artifact:candidate.id,status}));}
        catch(e){console.error(JSON.stringify({artifact:candidate.id,error:safeError(e)}));if(options.once)process.exitCode=1;}
        finally{client.release();}
      }
      if(!options.once&&!stopped)await new Promise(resolve=>setTimeout(resolve,5000));
    }while(!options.once&&!stopped);
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await pool.end();}
}
