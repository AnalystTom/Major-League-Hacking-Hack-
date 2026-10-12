import {createHash} from 'node:crypto';

// Stable per source: sibling topics remain recognizable as belonging to one video.
function hsl(h:number,s:number,l:number){
  const a=s*Math.min(l,1-l);
  const channel=(n:number)=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
export function sourceStyle(identity:string){
  const hue=createHash('sha256').update(identity).digest().readUInt32BE(0)%360;
  return {background:hsl(hue,.32,.12),surface:hsl(hue,.28,.20),accent:hsl(hue,.65,.76),muted:hsl(hue,.25,.72),line:hsl(hue,.23,.46)};
}
