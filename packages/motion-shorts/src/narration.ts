import OpenAI from 'openai';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {scriptSchema} from './contracts';
import {binary,probe,run} from './media';
import {hash} from './storage';

export function narrationTempo(actual:number,target:number){
  if(!Number.isFinite(actual)||actual<=0||!Number.isFinite(target)||target<=0)throw new Error('Invalid narration duration');
  const tempo=Math.max(1,actual/target);
  if(tempo>1.3)throw new Error('Narration exceeds the beat timing; shorten the script before retrying');
  return tempo;
}
export async function generateNarration(directory:string){
  const script=scriptSchema.parse(JSON.parse(await readFile(path.join(directory,'script.json'),'utf8')));
  const model=process.env.OPENAI_TTS_MODEL||'gpt-4o-mini-tts';
  const voice=process.env.OPENAI_TTS_VOICE||'coral';
  const client=new OpenAI({maxRetries:0,timeout:120000});
  const parts:string[]=[];
  for(const [i,beat] of script.beats.entries()){
    const name=`voice-${hash({text:beat.narration,model,voice}).slice(0,16)}.wav`;
    const raw=path.join(directory,name);
    try{await readFile(raw);}catch(e){
      if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
      const response=await client.audio.speech.create({model,voice,input:beat.narration,response_format:'wav'});
      await writeFile(raw,Buffer.from(await response.arrayBuffer()));
    }
    const audio=await probe(raw);if(!audio.hasAudio)throw new Error('Speech response contains no audio');
    const tempo=narrationTempo(audio.duration,beat.duration);
    const file=path.join(directory,`voice-beat-${i}.wav`);
    await run(await binary('ffmpeg'),['-y','-v','error','-i',raw,'-af',`atempo=${tempo},apad`,'-t',String(beat.duration),'-ar','48000','-ac','1',file]);parts.push(file);
  }
  const output=path.join(directory,'generated-narration.wav');
  await run(await binary('ffmpeg'),['-y','-v','error',...parts.flatMap(file=>['-i',file]),'-filter_complex',`${parts.map((_,i)=>`[${i}:a]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`,'-map','[out]',output]);
  const provenance=`AI-generated voice; OpenAI ${model}, voice ${voice}; each beat aligned to script timing`;
  await writeFile(path.join(directory,'narration-provenance.json'),JSON.stringify({provider:'openai',model,voice,scriptHash:hash(script),disclosure:'AI-generated voice'},null,2));
  return {file:output,provenance};
}
