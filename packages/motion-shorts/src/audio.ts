import {copyFile} from 'node:fs/promises';
import path from 'node:path';
import {binary,run,probe,checksum} from './media';
/** Provider implementations must produce local audio; no render process receives credentials. */
export interface NarrationProvider{generate(text:string,destination:string):Promise<{file:string;provider:string;voice:string}>;}
export type AudioInput={narration:string;music:string;musicProvenance:string;voiceProvenance:string};
export async function mixAudio(directory:string,input:AudioInput,duration:number){
  if(!input.musicProvenance.trim()||!input.voiceProvenance.trim())throw new Error('Voice and music provenance are required');
  const narration=await probe(input.narration);const music=await probe(input.music);
  if(!narration.hasAudio||!music.hasAudio)throw new Error('Narration/music must be decodable audio files');
  if(narration.duration>duration||narration.duration<duration*0.7)throw new Error('Narration must occupy 70–100% of the timeline. Revise timing/script before mixing.');
  const voice=path.join(directory,'narration.audio'),bed=path.join(directory,'music.audio');
  await copyFile(input.narration,voice);await copyFile(input.music,bed);
  await run(await binary('ffmpeg'),['-y','-v','error','-i',path.join(directory,'video.mp4'),'-i',voice,'-stream_loop','-1','-i',bed,'-filter_complex',`[1:a]apad,asplit=2[voice][side];[2:a]volume=0.12[music];[music][side]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=250[duck];[voice][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95,afade=t=out:st=${Math.max(0,duration-1)}:d=1[a]`,'-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(duration),'-movflags','+faststart',path.join(directory,'with-audio.mp4')],180000);
  return {narrationDuration:narration.duration,musicDuration:music.duration,musicProvenance:input.musicProvenance,voiceProvenance:input.voiceProvenance,narrationSha256:await checksum(voice),musicSha256:await checksum(bed)};
}
