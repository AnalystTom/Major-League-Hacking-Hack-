import type {Element} from './contracts';
export const frameCount=(duration:number,fps=30)=>Math.round(duration*fps);
export function valueAt(el:Element,property:Element['tracks'][number]['property'],time:number,fallback:number){
  const keys=el.tracks.find(t=>t.property===property)?.keyframes;
  if(!keys)return fallback;
  if(time<=keys[0].time)return keys[0].value;
  for(let i=1;i<keys.length;i++){
    if(time<=keys[i].time){
      const a=keys[i-1],b=keys[i];let u=(time-a.time)/(b.time-a.time);
      if(b.ease==='hold')u=time<b.time?0:1;else if(b.ease==='smooth')u=u*u*(3-2*u);
      return a.value+(b.value-a.value)*u;
    }
  }
  return keys[keys.length-1].value;
}
export function stateAt(el:Element,time:number){return {x:valueAt(el,'x',time,el.x),y:valueAt(el,'y',time,el.y),opacity:valueAt(el,'opacity',time,1),scale:valueAt(el,'scale',time,1),rotation:valueAt(el,'rotation',time,0),draw:valueAt(el,'draw',time,1)};}
