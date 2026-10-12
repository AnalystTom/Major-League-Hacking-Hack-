import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {browserPath} from './renderer';

/** Deterministic timeline: render the mechanism evolving, not a repeated still. */
export async function captureAnimation(directory:string,scenes:{html:string;duration:number;focus:number}[]){
  const fps=24,frames=path.join(directory,'frames');await mkdir(frames,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:browserPath()});
  const counts=scenes.map(scene=>Math.ceil(scene.duration*fps));
  try{
    await Promise.all(scenes.map(async(spec,scene)=>{
    let frame=counts.slice(0,scene).reduce((a,b)=>a+b,0);
    const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
    // tsx preserves function names with this helper inside serialized callbacks.
    await page.evaluate('globalThis.__name = (fn) => fn');
      await page.setContent(spec.html);
      await page.evaluate(()=>{
        for(const node of document.querySelectorAll<HTMLElement>('h1,.source-title')){
          let size=parseFloat(getComputedStyle(node).fontSize);
          const min=node.tagName==='H1'?58:24;
          while(node.scrollHeight>node.clientHeight+2&&size>min){size-=2;node.style.fontSize=`${size}px`;}
          if(node.scrollHeight>node.clientHeight+2)throw Error('Animated scene text overflow');
        }
      });
      const count=Math.ceil(spec.duration*fps);
      for(let i=0;i<count;i++){
        await page.evaluate(({t,duration,first,focus})=>{
          const svg=document.querySelector('.diagram svg') as SVGSVGElement;
          const nodes=[...svg.querySelectorAll<SVGGElement>(':scope > g')];
          const paths=[...svg.querySelectorAll<SVGPathElement>(':scope > path')];
          const ease=(n:number)=>1-Math.pow(1-Math.min(1,Math.max(0,n)),3);
          // The opening assembles the cast; subsequent beats keep it on screen.
          nodes.forEach((node,j)=>{
            const p=first?ease((t-j*.32)/.55):1;
            node.style.opacity=String(p);
            node.style.transformBox='fill-box';node.style.transformOrigin='center';
            node.style.scale=String(.94+.06*p+(j===focus?.025*Math.sin(Math.min(1,t/.7)*Math.PI/2):0));
            node.style.translate=`0 ${(1-p)*36}px`;
          });
          paths.forEach((edge,j)=>{
            const start=first?1.1+j*1.05:j*.65;
            const length=edge.getTotalLength(),progress=ease((t-start)/.9);
            // Observation stays dashed. Only transfers carry a moving packet.
            if(!edge.hasAttribute('stroke-dasharray')){
              edge.style.strokeDasharray=String(length);edge.style.strokeDashoffset=String(length*(1-progress));
            }else edge.style.opacity=String(progress);
            let dot=svg.querySelector<SVGCircleElement>(`[data-packet="${j}"]`);
            if(!dot){dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('data-packet',String(j));dot.setAttribute('r','8');dot.setAttribute('fill','#F3F1E8');svg.append(dot);}
            const travel=Math.max(0,t-start-1),cycle=Math.max(2.5,(duration-start)/2);
            const point=edge.getPointAtLength(length*(travel%cycle)/cycle);
            dot.setAttribute('cx',String(point.x));dot.setAttribute('cy',String(point.y));
            dot.style.opacity=String(t>start+1&&!edge.hasAttribute('stroke-dasharray')?1:0);
          });
        },{t:i/fps,duration:spec.duration,first:scene===0,focus:spec.focus});
        await page.screenshot({path:path.join(frames,`${String(frame++).padStart(5,'0')}.png`)});
      }
    await page.close();
    }));
  }finally{await browser.close();}
  return {pattern:path.join(frames,'%05d.png'),fps,frameCount:counts.reduce((a,b)=>a+b,0)};
}
