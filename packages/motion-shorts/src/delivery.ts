import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {S3Client,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import type {Job} from './jobs';
import {checksum,inspect,run} from './media';
import {cloudflareEnv} from './cloudflare';

export interface MediaUploader{upload(file:string,key:string,contentType:string):Promise<string>;}
export class LocalR2Uploader implements MediaUploader{
  constructor(private bucket='resurface-media'){}
  async upload(file:string,key:string,contentType:string){
    const web=fileURLToPath(new URL('../../../web/',import.meta.url));
    const cli=path.join(web,'node_modules/wrangler/bin/wrangler.js');
    const common=['--local','--config',path.join(web,'wrangler.jsonc'),'--persist-to',path.join(web,'.wrangler/state')];
    const object=`${this.bucket}/${key}`;
    await run(process.execPath,[cli,'r2','object','put',object,'--file',path.resolve(file),'--content-type',contentType,...common]);
    const dir=await mkdtemp(path.join(os.tmpdir(),'motion-r2-'));
    try{
      const downloaded=path.join(dir,'object');
      await run(process.execPath,[cli,'r2','object','get',object,'--file',downloaded,...common]);
      if(await checksum(file)!==await checksum(downloaded))throw new Error(`Local R2 checksum mismatch: ${key}`);
    }finally{await rm(dir,{recursive:true,force:true});}
    return `r2:${key}`;
  }
}
export function createMediaUploader(){
  const mode=process.env.MOTION_MEDIA_STORAGE||'r2';
  if(mode==='local')return new LocalR2Uploader(process.env.R2_BUCKET||'resurface-media');
  if(mode!=='r2')throw new Error('MOTION_MEDIA_STORAGE must be local or r2');
  return createR2Uploader();
}
export function requireDeliverable(job:Job){
  if(job.mode==='preview'||!['openai','opus'].includes(job.origin))throw new Error('Preview/fixture jobs cannot enter the shared feed');
  if(!['awaiting_review','approved'].includes(job.state)||!job.qa?.decoded||!job.audio)throw new Error('Completed video and audio QA required');
  if(job.qa.width!==1080||job.qa.height!==1920||job.qa.fps!==30||!job.qa.hasAudio||job.qa.audioCodec!=='aac')throw new Error('Feed requires 1080x1920 H.264/AAC at 30 fps');
}
export async function verifyDeliverable(job:Job,file:string){
  requireDeliverable(job);
  const current=await inspect(file,{width:1080,height:1920,fps:30,duration:job.qa!.duration});
  if(current.sha256!==job.qa!.sha256||!current.hasAudio||current.audioCodec!=='aac')throw new Error('Video changed after QA');
}
export class R2Uploader implements MediaUploader{
  constructor(private client:S3Client,private bucket:string){}
  async upload(file:string,key:string,contentType:string){
    const bytes=(await stat(file)).size;
    await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:createReadStream(file),ContentLength:bytes,ContentType:contentType}));
    // Read back the object: length alone does not establish that playback bytes
    // match the locally decoded/validated media.
    const remote=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:key}));
    if(!remote.Body||remote.ContentLength!==bytes)throw new Error(`Uploaded object size mismatch: ${key}`);
    const hash=createHash('sha256');
    for await(const chunk of remote.Body as AsyncIterable<Uint8Array>)hash.update(chunk);
    if(hash.digest('hex')!==await checksum(file))throw new Error(`Uploaded object checksum mismatch: ${key}`);
    return `r2:${key}`;
  }
}
export function createR2Uploader(env=process.env){
  env=cloudflareEnv(env);
  for(const name of ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET'])if(!env[name])throw new Error(`${name} is missing`);
  if(!/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID!))throw new Error('R2_ACCOUNT_ID must be a Cloudflare account ID');
  return new R2Uploader(new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID!,secretAccessKey:env.R2_SECRET_ACCESS_KEY!},maxAttempts:2}),env.R2_BUCKET!);
}
