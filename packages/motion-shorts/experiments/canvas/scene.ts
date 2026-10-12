import {makeScene2D,Rect,Txt,Line,Circle} from '@motion-canvas/2d';
import {createSignal,tween,linear} from '@motion-canvas/core';
import type {Plan} from '../../src/contracts';
import {stateAt} from '../../src/motion';

declare global {interface Window {scenePlan: Plan; scenePreview: boolean; sceneWidth: number; sceneHeight: number;}}

export default makeScene2D(function*(view){
  const p = window.scenePlan; const preview = window.scenePreview; const width = window.sceneWidth; const height = window.sceneHeight;
  const cx = width/2, cy = height/2; const baseSize = Math.min(width,height)/18; const time=createSignal(0); view.fill(p.background);
  const scaleX = width/720, scaleY = height/1280;
  const label=(text:string,x:number,y:number,size:number,fill:string,w=width*0.87)=>view.add(new Txt({text,x:x-cx,y:y-cy,fontFamily:'Arial',fontSize:size,fill,width:w,textAlign:'center'}));
  label('RESURFACE',cx,cy*0.086,Math.max(16,baseSize*0.27),p.accent);
  label(p.subtitle,cx,cy*0.198,Math.max(14,baseSize*0.23),'#8D999E');
  label(p.title,cx,cy*0.278,Math.max(24,baseSize*0.5),'#EDEDE6');
  for(const el of p.elements){
    const s=()=>stateAt(el,time());
    const common={x:()=>s().x*scaleX-cx,y:()=>s().y*scaleY-cy,opacity:()=>s().opacity,scale:()=>s().scale,rotation:()=>s().rotation,fill:el.fill,stroke:el.stroke,lineWidth:el.strokeWidth,width:el.width*scaleX,height:el.height*scaleY};
    if(el.kind==='rect')view.add(new Rect({...common,radius:el.radius*Math.min(scaleX,scaleY)}));
    if(el.kind==='circle')view.add(new Circle(common));
    if(el.kind==='text')view.add(new Txt({...common,text:el.text,fontSize:el.fontSize*Math.min(scaleX,scaleY),fontFamily:'Arial',textAlign:'center'}));
    if(el.kind==='path')view.add(new Line({points:el.points.map(([x,y])=>[x*scaleX-cx,y*scaleY-cy]),stroke:el.stroke,lineWidth:el.strokeWidth*Math.min(scaleX,scaleY),end:()=>s().draw,opacity:()=>s().opacity,lineCap:'round',radius:10*Math.min(scaleX,scaleY)}));
  }
  view.add(new Line({points:[[-cx*0.87,cy*0.586],[cx*0.87,cy*0.586]],stroke:'#34464E',lineWidth:1}));
  view.add(new Txt({text:()=>p.captions.find(c=>time()>=c.start&&time()<c.end)?.text??'',x:0,y:cy*0.727,width:width*0.82,fontSize:Math.max(20,29*Math.min(scaleX,scaleY)),lineHeight:Math.max(28,40*Math.min(scaleX,scaleY)),fill:'#EDEDE6',fontFamily:'Arial',textWrap:true,textAlign:'center'}));
  label(preview?'UNVERIFIED • DEVELOPMENT PREVIEW':'SOURCE-BACKED • REVIEW REQUIRED',cx,height*0.961,Math.max(12,15*Math.min(scaleX,scaleY)),'#8D999E');
  view.add(new Line({points:[[-cx*0.87,cy*0.875],[cx*0.87,cy*0.875]],stroke:p.accent,lineWidth:3*Math.min(scaleX,scaleY),end:()=>time()/p.duration}));
  yield* tween(p.duration,v=>time(linear(v)*p.duration));
});
