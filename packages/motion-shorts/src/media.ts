import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readdir,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Plan} from './contracts';

export async function binary(name:'ffmpeg'|'ffprobe'){
  const configured=process.env[name.toUpperCase()+'_PATH'];if(configured)return configured;
  try {for(const dir of await readdir('.tools')){const file=path.resolve('.tools',dir,'bin',`${name}.exe`);try{await stat(file);return file;}catch{/* try next */}}}catch{/* use PATH */}
  return name;
}
export function run(command:string,args:string[],timeout=120000,signal?:AbortSignal):Promise<string>{
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],signal});let out='';let err='';
    const timer=setTimeout(()=>{child.kill();reject(new Error(`${path.basename(command)} timed out after ${timeout}ms`));},timeout);
    child.stdout.on('data',(b:Buffer)=>{out=(out+b.toString()).slice(-2_000_000);});child.stderr.on('data',(b:Buffer)=>{err=(err+b.toString()).slice(-12000);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(out);else reject(new Error(`${path.basename(command)} exited ${code}: ${err}`));});
  });
}
export async function checksum(file:string){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
type Stream={codec_type:string;codec_name:string;width?:number;height?:number;avg_frame_rate?:string;pix_fmt?:string};
export async function probe(file:string){
  const raw=JSON.parse(await run(await binary('ffprobe'),['-v','error','-show_streams','-show_format','-of','json',path.resolve(file)])) as {streams:Stream[];format:{duration:string;size:string}};
  const v=raw.streams.find(s=>s.codec_type==='video');const rate=v?.avg_frame_rate?.split('/').map(Number)??[0,1];
  return {width:v?.width??0,height:v?.height??0,fps:rate[0]/rate[1],codec:v?.codec_name??null,pixelFormat:v?.pix_fmt??null,duration:Number(raw.format.duration),bytes:Number(raw.format.size),hasAudio:raw.streams.some(s=>s.codec_type==='audio'),audioCodec:raw.streams.find(s=>s.codec_type==='audio')?.codec_name??null};
}
export type Media=Awaited<ReturnType<typeof probe>>;
export async function inspect(file:string,expected?:{width:number;height:number;fps:number;duration:number}){
  const metadata=await probe(file);
  await run(await binary('ffmpeg'),['-v','error','-xerror','-i',path.resolve(file),'-f','null','-'],180000);
  if(!metadata.width||!metadata.bytes||metadata.codec!=='h264'||metadata.pixelFormat!=='yuv420p')throw new Error('Invalid H.264/yuv420p video');
  if(expected&&(metadata.width!==expected.width||metadata.height!==expected.height||Math.abs(metadata.fps-expected.fps)>0.01||Math.abs(metadata.duration-expected.duration)>0.15))throw new Error('Measured media does not match render settings');
  return {...metadata,sha256:await checksum(file),decoded:true,verifiedAt:new Date().toISOString()};
}
export async function previews(file:string,directory:string,duration:number){
  await mkdir(directory,{recursive:true});const ff=await binary('ffmpeg');
  for(const [i,fraction]of [0.12,0.37,0.62,0.87].entries())await run(ff,['-y','-v','error','-ss',String(duration*fraction),'-i',path.resolve(file),'-frames:v','1',path.join(directory,`frame-${i+1}.png`)]);
  await run(ff,['-y','-v','error','-i',path.resolve(file),'-vf',`fps=4/${duration},scale=270:480,tile=4x1`,'-frames:v','1',path.join(directory,'contact-sheet.png')]);
}
export async function blackSegments(file:string){
  // blackdetect writes to stderr; use a separate bounded invocation to retain that diagnostic.
  return new Promise<string[]>((resolve,reject)=>{let log='';binary('ffmpeg').then(ff=>{
    const child=spawn(ff,['-hide_banner','-i',path.resolve(file),'-vf','blackdetect=d=0.6:pix_th=0.03:pic_th=0.98','-an','-f','null','-'],{windowsHide:true});
    const timer=setTimeout(()=>child.kill(),120000);child.stderr.on('data',(b:Buffer)=>{log=(log+b.toString()).slice(-50000);});child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error('Black-frame analysis failed'));else resolve(log.split('\n').filter(l=>l.includes('black_start:')));});
  }).catch(reject);});
}
export function captionsVtt(plan:Plan){const stamp=(s:number)=>new Date(Math.round(s*1000)).toISOString().slice(11,23);return 'WEBVTT\n\n'+plan.captions.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.replace(/-->/g,'→').replace(/[<>]/g,'')}\n`).join('\n');}
export async function writeCaptions(plan:Plan,directory:string){await writeFile(path.join(directory,'captions.vtt'),captionsVtt(plan));}
