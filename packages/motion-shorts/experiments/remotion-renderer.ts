import {bundle} from '@remotion/bundler';
import {renderFrames} from '@remotion/renderer';
import {mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Plan} from '../src/contracts';
import {planSchema} from '../src/contracts';
import {binary,run} from '../src/media';
import {frameCount} from '../src/motion';
export type RenderConfig={width:number;height:number;fps:number;concurrency:number};
export const productionConfig:RenderConfig={width:1080,height:1920,fps:30,concurrency:2};
export const previewConfig:RenderConfig={width:720,height:1280,fps:30,concurrency:2};
export function validateConfig(c:RenderConfig){if(![720,1080].includes(c.width)||c.height!==c.width*16/9||c.fps!==30||!Number.isInteger(c.concurrency)||c.concurrency<1||c.concurrency>4)throw new Error('Use 720x1280 or 1080x1920 at 30fps and concurrency 1..4');return c;}
export function browserPath(){return process.env.MOTION_BROWSER??(process.platform==='win32'?'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe':undefined);}
export async function renderVideo(plan:Plan,directory:string,config=productionConfig,preview=true){
  planSchema.parse(plan);validateConfig(config);await mkdir(directory,{recursive:true});const start=performance.now();
  const frames=path.join(directory,'frames');await mkdir(frames,{recursive:true});
  const serveUrl=await bundle({entryPoint:fileURLToPath(new URL('./remotion-composition.tsx',import.meta.url)),outDir:path.join(directory,'bundle')});
  await renderFrames({serveUrl,onStart:()=>{},onFrameUpdate:()=>{},composition:{id:'MotionShort',width:config.width,height:config.height,fps:config.fps,durationInFrames:frameCount(plan.duration,config.fps),defaultProps:{plan,preview},props:{plan,preview},defaultCodec:'h264',defaultOutName:null,defaultVideoImageFormat:'png',defaultPixelFormat:'yuv420p',defaultProResProfile:null,defaultSampleRate:null},inputProps:{plan,preview},outputDir:frames,imageFormat:'png',concurrency:config.concurrency,browserExecutable:browserPath(),timeoutInMilliseconds:30000,chromiumOptions:{disableWebSecurity:false}});
  const output=path.join(directory,'video.mp4');
  await run(await binary('ffmpeg'),['-y','-v','error','-framerate',String(config.fps),'-i',path.join(frames,'element-%0'+String(frameCount(plan.duration,config.fps)-1).length+'d.png'),'-frames:v',String(frameCount(plan.duration,config.fps)),'-c:v','libx264','-threads','2','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',output],180000);
  await rm(frames,{recursive:true,force:true});await rm(path.join(directory,'bundle'),{recursive:true,force:true});
  return {output,renderMs:Math.round(performance.now()-start),engine:'remotion',config};
}
