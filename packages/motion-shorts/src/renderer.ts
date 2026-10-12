import {mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import type {Plan} from './contracts';
import {planSchema} from './contracts';
import {binary,run} from './media';
import {frameCount} from './motion';

export type Engine = 'motion-canvas' | 'remotion';
export type RenderConfig = {width:number;height:number;fps:number;concurrency:number;engine?:Engine};
export const productionConfig:RenderConfig = {width:1080,height:1920,fps:30,concurrency:2,engine:'remotion'};
export const previewConfig:RenderConfig = {width:720,height:1280,fps:30,concurrency:2,engine:'motion-canvas'};

export function validateConfig(c:RenderConfig){
  if(!([720,1080].includes(c.width))||c.height!==c.width*16/9||c.fps!==30||!Number.isInteger(c.concurrency)||c.concurrency<1||c.concurrency>4){
    throw new Error('Use 720x1280 or 1080x1920 at 30fps and concurrency 1..4');
  }
  if(c.engine&&!['motion-canvas','remotion'].includes(c.engine))throw new Error('Engine must be motion-canvas or remotion');
  return c;
}

export function browserPath(){
  return process.env.MOTION_BROWSER??(process.platform==='win32'?'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe':undefined);
}

export async function renderVideo(plan:Plan,directory:string,config=productionConfig,preview=true,voice=false){
  planSchema.parse(plan);validateConfig(config);await mkdir(directory,{recursive:true});const start=performance.now();
  const frames=path.join(directory,'frames');await mkdir(frames,{recursive:true});
  const engine=config.engine??'motion-canvas';
  if(engine==='motion-canvas'){
    await renderMotionCanvas(plan,frames,config,preview);
  }else{
    await renderRemotion(plan,frames,config,preview,voice);
  }
  const output=path.join(directory,'video.mp4');
  const totalFrames=frameCount(plan.duration,config.fps);
  const inputPattern=engine==='motion-canvas'?path.join(frames,'frame-%d.png'):path.join(frames,`element-%0${String(totalFrames-1).length}d.png`);
  await run(await binary('ffmpeg'),['-y','-v','error','-framerate',String(config.fps),'-i',inputPattern,'-frames:v',String(totalFrames),'-c:v','libx264','-threads','2','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',output],180000);
  await rm(frames,{recursive:true,force:true});
  if(engine==='remotion')await rm(path.join(directory,'bundle'),{recursive:true,force:true});
  const renderMs=Math.round(performance.now()-start);
  return {output,renderMs,engine,config};
}

async function renderRemotion(plan:Plan,frames:string,config:RenderConfig,preview:boolean,voice:boolean){
  const {bundle} = await import('@remotion/bundler');
  const {renderFrames} = await import('@remotion/renderer');
  const serveUrl=await bundle({entryPoint:fileURLToPath(new URL('./composition.tsx',import.meta.url)),outDir:path.join(path.dirname(frames),'bundle')});
  await renderFrames({serveUrl,onStart:()=>{},onFrameUpdate:()=>{},composition:{id:'MotionShort',width:config.width,height:config.height,fps:config.fps,durationInFrames:frameCount(plan.duration,config.fps),defaultProps:{plan,preview,voice},props:{plan,preview,voice},defaultCodec:'h264',defaultOutName:null,defaultVideoImageFormat:'png',defaultPixelFormat:'yuv420p',defaultProResProfile:null,defaultSampleRate:null},inputProps:{plan,preview,voice},outputDir:frames,imageFormat:'png',concurrency:config.concurrency,browserExecutable:browserPath(),timeoutInMilliseconds:30000,chromiumOptions:{disableWebSecurity:false}});
}

async function renderMotionCanvas(plan:Plan,frames:string,config:RenderConfig,preview:boolean){
  const renderWidth=config.width,renderHeight=config.height;
  const server=await createServer({root:path.resolve('experiments/canvas'),configFile:path.resolve('experiments/canvas/vite.config.mjs'),server:{port:5199,strictPort:true}});
  await server.listen();
  const browser=await chromium.launch({headless:true,executablePath:browserPath()});
  try{
    const page=await browser.newPage();
    page.on('console',m=>console.log('[motion-canvas]',m.text(),m.type()));
    page.on('pageerror',e=>console.error('[motion-canvas] pageerror:',e.message));
    page.on('requestfailed',r=>console.error('[motion-canvas] requestfailed:',r.url(),r.failure()?.errorText));
    await page.exposeFunction('saveFrame',async(frame:number,data:string)=>{const buffer=Buffer.from(data,'base64');await import('node:fs/promises').then(fs=>fs.writeFile(path.join(frames,`frame-${frame}.png`),buffer));});
    await page.goto('http://127.0.0.1:5199/index.html');
    await page.waitForFunction(()=>typeof (window as unknown as {startRender:unknown}).startRender==='function',{},{timeout:60000});
    await page.evaluate(({planJson,preview,width,height})=>{const plan=JSON.parse(planJson);(window as unknown as {scenePlan:unknown;scenePreview:boolean;sceneWidth:number;sceneHeight:number}).scenePlan=plan;(window as unknown as {scenePlan:unknown;scenePreview:boolean;sceneWidth:number;sceneHeight:number}).scenePreview=preview;(window as unknown as {scenePlan:unknown;scenePreview:boolean;sceneWidth:number;sceneHeight:number}).sceneWidth=width;(window as unknown as {scenePlan:unknown;scenePreview:boolean;sceneWidth:number;sceneHeight:number}).sceneHeight=height;},{planJson:JSON.stringify(plan),preview,width:renderWidth,height:renderHeight});
    const renderResult=await page.evaluate(async()=>{try{await (window as unknown as {startRender:()=>Promise<void>}).startRender();return {success:true};}catch(e){return {success:false,error:String(e)};}});
    console.log('[motion-canvas] renderResult:',renderResult);
    if(!renderResult.success)throw new Error(renderResult.error);
    await page.waitForFunction(()=>(window as unknown as {renderComplete:boolean}).renderComplete===true,{},{timeout:180000});
  }finally{await browser.close();await server.close();}
}