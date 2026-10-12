import {it,expect,vi,afterEach} from 'vitest';
import type pg from 'pg';
import {processArtifact,type ReadyVideo} from '../src/worker';
import {requireDeliverable,R2Uploader} from '../src/delivery';
import {narrationTempo} from '../src/narration';
import {synthesizeMusic} from '../src/music';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {S3Client} from '@aws-sdk/client-s3';
import type {Job} from '../src/jobs';
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const id='22222222-2222-4222-8222-222222222222',source='11111111-1111-4111-8111-111111111111';
function database(status?:string,locked=true){
  const query=vi.fn(async(sql:string)=>{
    if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked}],rowCount:1};
    if(sql.startsWith('SELECT id,status,opus_prompt_revision FROM video_results'))return {rows:status?[{id:'result',status}]:[],rowCount:status?1:0};
    if(sql.startsWith('SELECT * FROM artifacts'))return {rows:[{id,version:1,name:'Loop',category:'Tests',processed_text:'Run a test',source_ids:[source],evidence:[{source_id:source,start_seconds:0,end_seconds:10,passage:'Run a test'}],ingestion_status:'ready',review_status:'pending',project_context_id:null,project_context_version:null}],rowCount:1};
    if(sql.startsWith('SELECT id,source_url'))return {rows:[{id:source,source_url:'https://example.com/source',title:null,status:'ready'}],rowCount:1};
    return {rows:[{id:'result'}],rowCount:1};
  });
  return {client:{query} as unknown as pg.PoolClient,query};
}
const result:ReadyVideo={media_ref:'r2:videos/a/1/short.mp4',caption_ref:'r2:captions/a/1/short.vtt',narration_ref:'r2:videos/a/1/narration.wav',music_ref:'r2:videos/a/1/music.audio',music_provenance:'procedural',duration_seconds:12,script:{}};
it('preserves a ready clip when its visual refresh fails',async()=>{
  const db=database('ready');
  await expect(processArtifact(db.client,id,1,async()=>{throw new Error('Refresh failed');},false,true)).rejects.toThrow('Refresh failed');
  expect(db.query.mock.calls.some(([sql])=>sql.includes("SET status='running'")||sql.includes("SET status='failed'"))).toBe(false);
  expect(db.query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock');
});
it('writes ready only after successful media delivery and releases its lock',async()=>{
  const db=database();const build=vi.fn(async()=>{expect(db.query.mock.calls.some(([sql])=>sql.includes("SET status='ready'"))).toBe(false);return result;});
  expect(await processArtifact(db.client,id,1,build)).toBe('ready');
  expect(build).toHaveBeenCalledOnce();expect(db.query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock');
});
it('does not render duplicate, busy, or failed jobs automatically',async()=>{
  for(const [state,locked] of [['ready',true],['failed',true],[undefined,false]] as const){
    const db=database(state,locked),build=vi.fn();await processArtifact(db.client,id,1,build);expect(build).not.toHaveBeenCalled();
  }
});
it('records upload/generation failure without exposing a ready row',async()=>{
  const db=database();await expect(processArtifact(db.client,id,1,async()=>{throw new Error('Upload verification failed');})).rejects.toThrow('Upload');
  expect(db.query.mock.calls.some(([sql])=>sql.includes("SET status='failed'"))).toBe(true);
  expect(db.query.mock.calls.some(([sql])=>sql.includes("SET status='ready'"))).toBe(false);
  expect(db.query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock');
});
it('allows an explicit retry of failed work',async()=>{
  const db=database('failed'),build=vi.fn(async()=>result);expect(await processArtifact(db.client,id,1,build,true)).toBe('ready');expect(build).toHaveBeenCalledOnce();
});
it('blocks fixtures, previews, and missing audio from delivery',()=>{
  expect(()=>requireDeliverable({mode:'preview',origin:'openai'} as Job)).toThrow('Preview');
  expect(()=>requireDeliverable({mode:'sourced',origin:'fixture'} as Job)).toThrow('fixture');
  expect(()=>requireDeliverable({mode:'sourced',origin:'openai',state:'awaiting_review',qa:{decoded:true}} as Job)).toThrow('audio QA');
});
it('rejects narration that cannot fit safely instead of cutting spoken words',()=>{
  expect(narrationTempo(8,10)).toBe(1);expect(narrationTempo(12,10)).toBe(1.2);expect(()=>narrationTempo(15,10)).toThrow('shorten');
});
it('synthesizes a bounded PCM WAV without external samples',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'motion-audio-'));dirs.push(dir);const file=path.join(dir,'bed.wav');
  await synthesizeMusic(file,2);const bytes=await readFile(file);expect(bytes.toString('ascii',0,4)).toBe('RIFF');expect(bytes.length).toBe(44+24000*2*2);
});
it('reads uploaded bytes back and rejects equal-length corruption',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'motion-upload-'));dirs.push(dir);const file=path.join(dir,'media');await writeFile(file,'good');
  const send=vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ContentLength:4,Body:(async function*(){yield Buffer.from('evil');})()});
  const uploader=new R2Uploader({send} as unknown as S3Client,'bucket');await expect(uploader.upload(file,'videos/a/1/short.mp4','video/mp4')).rejects.toThrow('checksum');
});

it('does not publish when the lock-owning database connection dies during generation',async()=>{
  const db=database('ready');let emitError:(e:Error)=>void=()=>{};
  db.client.on=vi.fn((_event,handler)=>{emitError=handler;return db.client;}) as typeof db.client.on;
  db.client.removeListener=vi.fn(()=>db.client);
  await expect(processArtifact(db.client,id,1,async()=>{emitError(new Error('Connection lost'));return result;},false,true)).rejects.toThrow('Connection lost');
  expect(db.query.mock.calls.some(([sql])=>sql.includes("SET status='ready'"))).toBe(false);
  expect(db.client.removeListener).toHaveBeenCalled();
});
