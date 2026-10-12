import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {feedbackFixture} from '../src/fixtures';
import {renderVideo,previewConfig,browserPath} from './remotion-renderer';
import {binary,run,inspect,previews} from '../src/media';
const root=path.resolve('artifacts/benchmark');await mkdir(root,{recursive:true});
const plan=feedbackFixture();await writeFile(path.join(root,'plan.json'),JSON.stringify(plan,null,2));
const candidates=process.argv.slice(2);const results:unknown[]=[];
for(const engine of candidates.length?candidates:['motion-canvas','remotion']){
  const dir=path.join(root,engine);await mkdir(dir,{recursive:true});const start=performance.now();
  try{
    if(engine==='motion-canvas'){
      const frames=path.join(dir,'frames');await mkdir(frames,{recursive:true});
      const server=await createServer({root:path.resolve('experiments/canvas'),configFile:path.resolve('experiments/canvas/vite.config.mjs'),server:{port:5199,strictPort:true}});await server.listen();
      const browser=await chromium.launch({headless:true,executablePath:browserPath()});
      try{
        const page=await browser.newPage();page.on('console',m=>console.log(m.text()));page.on('pageerror',e=>console.error(e));
        await page.exposeFunction('saveFrame',async(frame:number,data:string)=>{await writeFile(path.join(frames,`frame-${frame}.png`),Buffer.from(data,'base64'));});
        await page.goto('http://127.0.0.1:5199/index.html');await page.waitForFunction(()=>typeof (window as unknown as {startRender:unknown}).startRender==='function',{},{timeout:60000});
        await page.evaluate(async()=>{await (window as unknown as {startRender:()=>Promise<void>}).startRender();});
      }finally{await browser.close();await server.close();}
      await run(await binary('ffmpeg'),['-y','-v','error','-framerate','30','-i',path.join(frames,'frame-%d.png'),'-frames:v','360','-c:v','libx264','-threads','2','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path.join(dir,'video.mp4')],180000);
    }else await renderVideo(plan,dir,previewConfig);
    const renderMs=Math.round(performance.now()-start);
    const qa=await inspect(path.join(dir,'video.mp4'),{...previewConfig,duration:12});await previews(path.join(dir,'video.mp4'),dir,12);
    const result={engine,renderMs,qa,generation:'hand-authored development fixture',model:null,providerCalls:0};results.push(result);await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }catch(e){const result={engine,error:String(e),elapsedMs:Math.round(performance.now()-start)};results.push(result);await writeFile(path.join(dir,'error.json'),JSON.stringify(result,null,2));console.error(result);process.exitCode=1;}
}
await writeFile(path.join(root,'results.json'),JSON.stringify(results,null,2));
