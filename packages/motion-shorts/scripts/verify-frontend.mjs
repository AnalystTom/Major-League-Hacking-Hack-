import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const output=new URL('../artifacts/frontend-qa/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.MOTION_BROWSER||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'});
try{
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const home=await page.goto('http://127.0.0.1:8787/');
  await page.screenshot({path:new URL('home.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  const start=await page.goto('http://127.0.0.1:8787/start');
  await page.waitForFunction(()=>!document.querySelector('[data-step="account"]')?.hidden||document.querySelector('[data-loading]')?.textContent?.includes("can't reach"));
  const me=await context.request.get('http://127.0.0.1:8787/api/me');
  const report={home:home.status(),start:start.status(),me:me.status(),pageErrors:errors,accountCreated:false};
  if(me.ok()){
    await page.locator('#su-name').fill('Local QA');
    await page.locator('#su-email').fill(`local-qa-${Date.now()}@example.test`);
    await page.locator('#su-password').fill('local-qa-strong-password-2026');
    const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/auth/signup'));
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    const response=await responsePromise;report.signup=response.status();report.accountCreated=response.ok();
    if(response.ok()){
      await page.waitForURL('**/app');
      await page.locator('[data-home-body]').waitFor({state:'visible'});
      report.feed=(await context.request.get('http://127.0.0.1:8787/api/feed?scope=mine')).status();
      report.imports=(await context.request.get('http://127.0.0.1:8787/api/imports')).status();
    }
  }else{
    report.blocker=await page.locator('[data-loading]').innerText();
  }
  await page.screenshot({path:new URL('onboarding.png',output).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  await page.goto('http://127.0.0.1:8787/media/videos/dev/simulation/short.mp4');
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  await page.evaluate(async()=>{const video=document.querySelector('video');video.muted=true;await video.play();});
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.2);
  report.video=await page.evaluate(()=>{const video=document.querySelector('video');video.pause();return {width:video.videoWidth,height:video.videoHeight,duration:video.duration,played:video.currentTime>0};});
  await page.screenshot({path:new URL('video.png',output).pathname.replace(/^\/([A-Z]:)/,'$1')});
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  await context.close();
}finally{await browser.close();}
