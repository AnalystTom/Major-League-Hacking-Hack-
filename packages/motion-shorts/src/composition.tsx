import React from 'react';
import {AbsoluteFill,Composition,registerRoot,useCurrentFrame,useVideoConfig} from 'remotion';
import type {Plan} from './contracts';
import {stateAt,frameCount} from './motion';
import {feedbackFixture} from './fixtures';
export function Graphic({plan,time,preview=true,voice=false}:{plan:Plan;time:number;preview?:boolean;voice?:boolean}){
  const caption=plan.captions.find(c=>time>=c.start&&time<c.end);
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280" width="100%" height="100%" style={{fontFamily:'Arial, sans-serif'}}>
    <rect width="720" height="1280" fill={plan.background}/>
    <text x="48" y="62" fill={plan.accent} fontSize="20" letterSpacing="5">RESURFACE</text>
    <text x="672" y="62" textAnchor="end" fill="#8D999E" fontSize="14">{preview?'DEVELOPMENT PREVIEW':'ENGINEERING NOTES'}</text>
    <line x1="48" x2="672" y1="89" y2="89" stroke="#34464E"/>
    <text x="48" y="133" fill="#8D999E" fontSize="17" letterSpacing="2">{plan.subtitle}</text>
    <text x="48" y="190" fill="#EDEDE6" fontSize={plan.title.length>34?30:38} fontWeight="600">{plan.title}</text>
    {plan.elements.map(el=>{const s=stateAt(el,time);return <g key={el.id} opacity={s.opacity} transform={el.kind==='path'?undefined:`translate(${s.x} ${s.y}) rotate(${s.rotation}) scale(${s.scale})`}>
      {el.kind==='rect'&&<rect x={-el.width/2} y={-el.height/2} width={el.width} height={el.height} rx={el.radius} fill={el.fill} stroke={el.stroke} strokeWidth={el.strokeWidth}/>}
      {el.kind==='circle'&&<ellipse rx={el.width/2} ry={el.height/2} fill={el.fill} stroke={el.stroke} strokeWidth={el.strokeWidth}/>}
      {el.kind==='text'&&<text textAnchor="middle" fill={el.fill} fontSize={el.fontSize}>{el.text.split('\n').map((line,i,arr)=><tspan key={i} x="0" y={(i-(arr.length-1)/2)*el.fontSize*1.25+el.fontSize*0.34}>{line}</tspan>)}</text>}
      {el.kind==='path'&&<polyline points={el.points.map(p=>p.join(',')).join(' ')} fill="none" stroke={el.stroke} strokeWidth={el.strokeWidth} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1-s.draw}/>}
    </g>;})}
    <line x1="48" x2="672" y1="1015" y2="1015" stroke="#34464E"/>
    {caption&&<foreignObject x="64" y="1050" width="592" height="122"><div style={{color:'#EDEDE6',fontSize:29,lineHeight:1.4,textAlign:'center'}}>{caption.text}</div></foreignObject>}
    <rect x="48" y="1200" width="624" height="3" fill="#34464E"/><rect x="48" y="1200" width={624*Math.min(1,time/plan.duration)} height="3" fill={plan.accent}/>
    <text x="48" y="1240" fill="#8D999E" fontSize="15">{preview?'UNVERIFIED • FIXTURE / PREVIEW':voice?'SOURCE-BACKED • AI-GENERATED VOICE':'SOURCE-BACKED • AI-GENERATED VISUALS'}</text>
    <text x="672" y="1240" textAnchor="end" fill="#8D999E" fontSize="15">{Math.min(Math.floor(time)+1,Math.ceil(plan.duration)).toString().padStart(2,'0')} / {Math.ceil(plan.duration)}</text>
  </svg>;
}
export function Video({plan,preview=true,voice=false}:{plan:Plan;preview?:boolean;voice?:boolean}){const frame=useCurrentFrame();const {fps}=useVideoConfig();return <AbsoluteFill><Graphic plan={plan} time={frame/fps} preview={preview} voice={voice}/></AbsoluteFill>;}
const defaultPlan=feedbackFixture();
export const Root=()=> <Composition id="MotionShort" component={Video} width={1080} height={1920} fps={30} durationInFrames={360} defaultProps={{plan:defaultPlan,preview:true,voice:false}} calculateMetadata={({props})=>({durationInFrames:frameCount(props.plan.duration)})}/>;
registerRoot(Root);
