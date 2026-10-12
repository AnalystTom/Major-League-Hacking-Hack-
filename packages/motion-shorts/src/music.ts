import {writeFile} from 'node:fs/promises';

export const MUSIC_PROVENANCE='Resurface procedural ambient bed v1: locally synthesized sine tones; no third-party recordings or samples.';
export async function synthesizeMusic(file:string,duration:number){
  if(!Number.isFinite(duration)||duration<1||duration>90)throw new Error('Music duration outside 1..90 seconds');
  const rate=24000,samples=Math.ceil(duration*rate),data=Buffer.alloc(44+samples*2);
  data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);
  data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples*2,40);
  const chords=[[130.81,164.81,196],[110,130.81,164.81],[87.31,110,130.81],[98,123.47,146.83]];
  for(let i=0;i<samples;i++){
    const t=i/rate,bar=t%4,chord=chords[Math.floor(t/4)%4];
    const envelope=Math.min(1,bar/0.3,(4-bar)/0.5,t/1.5,(duration-t)/1.5);
    const value=chord.reduce((sum,f)=>sum+Math.sin(2*Math.PI*f*t),0)/3*0.2*Math.max(0,envelope);
    data.writeInt16LE(Math.round(value*32767),44+i*2);
  }
  await writeFile(file,data);
  return {file,provenance:MUSIC_PROVENANCE};
}
