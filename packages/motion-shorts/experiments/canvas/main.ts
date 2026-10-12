import {Renderer,Vector2} from '@motion-canvas/core';
import project from './project?project';

let renderResolve: (value: void | PromiseLike<void>) => void;
let renderReject: (reason?: unknown) => void;
window.renderComplete = false;
window.scenePlan = null;
window.scenePreview = true;
window.sceneWidth = 720;
window.sceneHeight = 1280;

Object.assign(window,{startRender:async()=>{
  return new Promise<void>((resolve,reject)=>{renderResolve=resolve;renderReject=reject;
    const renderer=new Renderer(project);
    renderer.onFinished.subscribe(value=>{window.renderComplete=true;if(value!==0){console.error('Motion Canvas renderer error code:',value);renderReject(new Error(`Motion Canvas result ${value}`));}else renderResolve();});
    project.logger.onLogged.subscribe(value=>console.log(JSON.stringify(value)));
    try{
      renderer.render({name:'motion-short',range:[0,window.scenePlan.duration],fps:30,size:new Vector2(window.sceneWidth,window.sceneHeight),resolutionScale:1,colorSpace:'srgb',background:'#0D1B22',exporter:{name:'resurface/capture',options:{}},props:{plan:window.scenePlan,preview:window.scenePreview}});
    }catch(e){console.error('Motion Canvas render throw:',e);renderReject(e);}
  });
}});

interface Keyframe{time:number;value:number;ease:string;}
interface Track{property:string;keyframes:Keyframe[];}
interface Element{id:string;kind:string;x:number;y:number;width:number;height:number;text:string;fontSize:number;fill:string;stroke:string;strokeWidth:number;radius:number;points:number[][];tracks:Track[];}
interface Scene{id:string;start:number;end:number;purpose:string;explanation:string;transition:string;evidence_ids:string[];}
interface Caption{start:number;end:number;text:string;evidence_ids:string[];}
interface Plan{
  version:string;title:string;subtitle:string;duration:number;background:string;accent:string;
  scenes:Scene[];elements:Element[];captions:Caption[];
}