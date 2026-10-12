import {chromium} from 'playwright';
import {mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {browserPath} from './renderer';
import {escapeHtml} from './visual-language';
import {continuingObject,type EditorialPlan} from './editorial-plan';

import {illustratedKinds,illustratedProp,propActivity} from './editorial-props';

const fonts={sans:'Arial, sans-serif',serif:'Georgia, serif',mono:'Consolas, monospace'};
export function editorialHtml(plan:EditorialPlan,index:number,source:string){
  const shot=plan.shots[index];
  const elements=shot.elements.map((e,i)=>{
    const title=`<span class="object-title">${escapeHtml(e.text)}</span>`;
    let content=e.kind==='text'?escapeHtml(e.text):'';
    if((e.kind==='panel'||e.kind==='circle')&&e.text)content=title;
    if(e.kind==='document')content=`<div class="paper-fold"></div>${title}<div class="document-lines"><i></i><i></i><i></i><i></i></div>`;
    if(e.kind==='browser')content=`<div class="window-bar"><b></b><b></b><b></b></div>${title}<div class="window-content"><i></i><i></i></div>`;
    if(e.kind==='terminal')content=`<div class="terminal-bar">ILLUSTRATIVE WORKSPACE</div>${title}<div class="cursor"></div>`;
    if(e.kind==='waveform')content=`<svg viewBox="0 0 600 180" preserveAspectRatio="none">${Array.from({length:48},(_,j)=>{const h=20+130*Math.abs(Math.sin(j*.71)*Math.cos(j*.23));return `<rect x="${j*12.5}" y="${90-h/2}" width="6" height="${h}" rx="3" fill="currentColor"/>`;}).join('')}</svg>${title}`;
    if(illustratedKinds.has(e.kind))content=illustratedProp(e)+title;
    return `<div data-element="${i}" class="element ${e.kind}${illustratedKinds.has(e.kind)?' illustrated':''}" style="left:${e.x}px;top:${e.y}px;width:${e.width}px;height:${e.height}px;background:${(['text','line','waveform'].includes(e.kind)||illustratedKinds.has(e.kind))?'transparent':e.fill};color:${e.ink};--fill:${e.fill};font-family:${fonts[e.font]};font-size:${e.fontSize}px">${content}</div>`;
  }).join('');
  return `<!doctype html><html><head><style>
  *{box-sizing:border-box}body{margin:0;width:1080px;height:1920px;overflow:hidden;background:${shot.background};color:${shot.ink};font-family:Arial,sans-serif}
  .attribution{position:absolute;top:45px;left:54px;width:850px;font-size:${index===0?30:22}px;line-height:1.22;max-height:95px;overflow:hidden;opacity:.7}.brand{position:absolute;right:54px;top:49px;font-size:17px;letter-spacing:3px;writing-mode:vertical-rl;opacity:.55}
  .element{position:absolute;transform-origin:center;overflow:hidden}.text{font-weight:600;line-height:1.12;letter-spacing:-.035em;white-space:pre-line;overflow-wrap:break-word}.panel,.circle{display:grid;place-items:center;padding:20px;text-align:center}.panel{border-radius:24px}.circle{border-radius:50%}.line{border-top:4px solid var(--fill)}
  .document{border-radius:3px;box-shadow:14px 18px 0 #00000018;padding:45px 35px}.object-title{display:block;font-weight:600;line-height:1.15;overflow-wrap:break-word;white-space:pre-line}.paper-fold{position:absolute;right:0;top:0;width:44px;height:44px;background:#00000012;clip-path:polygon(0 0,100% 100%,0 100%)}.document-lines{display:grid;gap:19px;margin-top:35px;opacity:.25}.document-lines i{height:5px;background:currentColor}.document-lines i:nth-child(2){width:70%}.document-lines i:last-child{width:82%}
  .browser,.terminal{border:3px solid currentColor;border-radius:18px;padding:85px 32px 32px}.window-bar{position:absolute;left:0;right:0;top:0;height:52px;border-bottom:2px solid currentColor;display:flex;align-items:center;gap:12px;padding:0 20px}.window-bar b{width:9px;height:9px;border-radius:50%;background:currentColor;opacity:.55}.window-content{margin-top:32px;display:grid;gap:16px;opacity:.18}.window-content i{height:50px;background:currentColor;border-radius:6px}.window-content i:last-child{width:65%;height:8px}.terminal-bar{position:absolute;top:22px;left:28px;font:16px Arial,sans-serif;letter-spacing:2px;opacity:.6}.cursor{width:18px;height:36px;background:currentColor;margin-top:25px}.waveform svg{width:100%;height:70%}.waveform .object-title{font-size:30px;margin-top:16px}
  .illustrated svg{width:100%;height:calc(100% - 85px);overflow:visible}.illustrated .object-title{position:absolute;bottom:0;left:0;right:0;width:fit-content;max-width:100%;margin:0 auto;text-align:center;font-size:34px;line-height:1.15;padding:10px 14px;border-radius:8px;color:${shot.ink};background:${shot.background}}.illustrated{overflow:visible}.waveform svg{transform:scaleY(var(--wave-scale,1));transform-origin:center}
  .caption-band{position:absolute;top:1590px;bottom:0;left:0;right:0;background:#101719}.footer{position:absolute;left:54px;right:54px;bottom:48px;display:flex;justify-content:space-between;color:#B1BFBE;font-size:18px;letter-spacing:1px}
  </style></head><body><div class="attribution">${escapeHtml(source)}</div><div class="brand">RESURFACE</div>${elements}<div class="caption-band"></div><div class="footer"><span>AI-NARRATED · SOURCE-BACKED</span><span>${String(index+1).padStart(2,'0')} / ${String(plan.shots.length).padStart(2,'0')}</span></div></body></html>`;
}

export function editorialFrame(plan:EditorialPlan,index:number,time:number,duration:number){
  const shot=plan.shots[index],previous=plan.shots[index-1];
  return shot.elements.map(e=>{
    const t=time/duration,progress=Math.min(1,Math.max(0,(t-e.delay)/e.span)),p=1-Math.pow(1-progress,3);
    const arriving=e.motion==='arrive',travel=e.motion==='travel';
    const moving=illustratedKinds.has(e.kind)?progress*progress*(3-2*progress):p;
    const dx=arriving?e.dx*(1-p):travel?e.dx*moving:0,dy=arriving?e.dy*(1-p):travel?e.dy*moving:0;
    const prior=previous?.elements.find(old=>continuingObject(old,e));
    const cut=Math.min(1,time/Math.min(.6,duration*.2)),blend=cut*cut*(3-2*cut);
    const oldX=prior?prior.x+(prior.motion==='travel'?prior.dx:0):e.x,oldY=prior?prior.y+(prior.motion==='travel'?prior.dy:0):e.y;
    const mix=(a:number,b:number)=>a+(b-a)*blend;
    return {x:prior?mix(oldX,e.x+dx):e.x+dx,y:prior?mix(oldY,e.y+dy):e.y+dy,
      width:prior?mix(prior.width,e.width):e.width,height:prior?mix(prior.height,e.height):e.height,
      opacity:prior?1:arriving?Math.min(1,progress*4):t>=e.delay?1:0,
      clip:e.motion==='draw'?`inset(0 ${(1-p)*100}% 0 0)`:'none'};
  });
}

export async function captureEditorial(plan:EditorialPlan,durations:number[],source:string,directory:string){
  const fps=24,frames=path.join(directory,'frames');await mkdir(frames,{recursive:true});
  const counts=durations.map(d=>Math.ceil(d*fps)),browser=await chromium.launch({headless:true,executablePath:browserPath()});
  const layoutReport:{shot:string;element:string;size:number}[]=[];
  try{
    // Three pages share one browser; avoid opening a process per shot.
    let next=0;
    await Promise.all(Array.from({length:Math.min(3,plan.shots.length)},async()=>{
      const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
      await page.evaluate('globalThis.__name=(fn)=>fn');
      for(;;){
        const index=next++;if(index>=plan.shots.length)break;
        const shot=plan.shots[index];await page.setContent(editorialHtml(plan,index,source));
        const sizes=await page.evaluate(()=>[...document.querySelectorAll<HTMLElement>('.text')].map(el=>{
          let size=parseFloat(getComputedStyle(el).fontSize);
          while((el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2)&&size>32){size-=2;el.style.fontSize=`${size}px`;}
          if(el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2)throw Error('Shot typography does not fit');
          return {element:el.dataset.element!,size};
        }));
        layoutReport.push(...sizes.map(s=>({shot:shot.id,...s})));
        const offset=counts.slice(0,index).reduce((a,b)=>a+b,0);
        for(let frame=0;frame<counts[index];frame++){
          await page.evaluate(({states,activity})=>{
            states.forEach((state,i)=>{
              const el=document.querySelector<HTMLElement>(`[data-element="${i}"]`)!;
              el.style.left=`${state.x}px`;el.style.top=`${state.y}px`;
              el.style.width=`${state.width}px`;el.style.height=`${state.height}px`;
              el.style.opacity=String(state.opacity);el.style.clipPath=state.clip;
              el.querySelector('[data-lift]')?.setAttribute('transform',`translate(0 ${activity.lift})`);
              el.querySelector('[data-watch]')?.setAttribute('transform',`translate(${activity.look} 0)`);
              el.querySelectorAll('[data-flow]').forEach(line=>line.setAttribute('stroke-dashoffset',String(activity.flow)));

              el.style.setProperty('--wave-scale',String(.7+activity.scan*.3));
            });
          },{states:editorialFrame(plan,index,frame/fps,counts[index]/fps),activity:propActivity((offset+frame)/fps)});
          const file=path.join(frames,`${String(offset+frame).padStart(5,'0')}.png`);
          await page.screenshot({path:file});
          if(frame===Math.floor(counts[index]*.65))await copyFile(file,path.join(directory,`shot-${index+1}.png`));
        }
      }
      await page.close();
    }));
  }finally{await browser.close();}
  return {pattern:path.join(frames,'%05d.png'),fps,frameCount:counts.reduce((a,b)=>a+b,0),layoutReport};
}
