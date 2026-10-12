import OpenAI from 'openai';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {inputSchema,type Technique} from './contracts';
import {createProvider} from './provider';
import {hash,LocalStore} from './storage';
import {binary,run,probe,inspect,checksum} from './media';
import {synthesizeMusic} from './music';
import {captionCues,captionsAss} from './visual-language';
import {captureEditorial} from './editorial-stage';
import {editorialPlanSchema,validateEditorialPlan,EDITORIAL_DIRECTION,EDITORIAL_REVISION,coverageSchema,visualBrief,type EditorialPlan} from './editorial-plan';
import type {MediaUploader} from './delivery';
import type {ReadyVideo} from './worker';

export async function renderEditorialShort(input:Technique,root:string,uploader?:MediaUploader):Promise<ReadyVideo & {directory:string;elapsedMs:number}>{
  input=inputSchema.parse(input);if(input.mode==='preview')throw Error('Editorial production requires sourced evidence');
  const start=performance.now(),timings:Record<string,number>={},store=new LocalStore(root);
  const brief=visualBrief(input);
  const id=`film-${hash({input,revision:EDITORIAL_REVISION,brief}).slice(0,24)}`;
  return store.withLock(id,async()=>{
    const dir=store.directory(id);await mkdir(dir,{recursive:true});await store.write(id,'input.json',input);
    const provider=createProvider();let plan:EditorialPlan|undefined;
    try{plan=validateEditorialPlan(input,JSON.parse(await readFile(path.join(dir,'direction.json'),'utf8')));}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    let correction:string|undefined;
    for(let attempt=0;attempt<2;attempt++){
      if(!plan){
        const result=await provider.generate('editorial_direction',editorialPlanSchema,{input,task:EDITORIAL_DIRECTION,selected_visual_brief:brief,priority:'The selected visual brief overrides stylistic examples in the general direction.'},correction);
        await store.write(id,`direction-attempt-${attempt+1}.json`,result.value);
        try{plan=validateEditorialPlan(input,result.value);}
        catch(error){if(attempt===1)throw error;correction=String(error);continue;}
        await store.write(id,'direction-provenance.json',{model:provider.model,requestId:result.requestId,usage:result.usage,revision:EDITORIAL_REVISION});
      }
      const planHash=hash(plan);let audit:zCoverage|undefined;
      try{const cached=JSON.parse(await readFile(path.join(dir,'coverage.json'),'utf8'));if(cached.planHash===planHash)audit=coverageSchema.parse(cached.audit);}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(!audit){
        const result=await provider.generate('fast_short',coverageSchema,{input,plan,task:'Audit this film against ALL material points of processed_text and supplied evidence. Read the actual narration, not just point_ids. List substantive omitted facts, distinctions or caveats in missing_points. List invented or overstated spoken/on-screen claims in unsupported_claims. List misleading visual implications in visual_misrepresentations. Do not demand verbatim wording or incidental details; equivalent complete paraphrases are valid. This is a source-grounded topic explainer, not a summary of the entire source video. Return empty arrays only when it passes.'});
        audit=result.value;await store.write(id,'coverage.json',{planHash,audit,requestId:result.requestId});
      }
      const issues=[...audit.missing_points,...audit.unsupported_claims,...audit.visual_misrepresentations];
      if(!issues.length){await store.write(id,'direction.json',plan);break;}
      if(attempt===1)throw Error(`Content coverage review failed: ${issues.join('; ')}`);
      correction=`Revise the film to resolve these content issues without dropping any other point: ${issues.join('; ')}`;plan=undefined;
    }
    if(!plan)throw Error('No validated editorial plan');
    timings.directionAndCoverageMs=Math.round(performance.now()-start);
    const voiceStart=performance.now(),client=new OpenAI({maxRetries:0,timeout:30000});
    const voice=process.env.OPENAI_TTS_VOICE||'coral',model=process.env.OPENAI_TTS_MODEL||'gpt-4o-mini-tts';
    const speech=await Promise.all(plan.shots.map(async shot=>{
      const file=path.join(dir,`voice-${hash({text:shot.narration,voice,model}).slice(0,16)}.wav`);
      try{await readFile(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const response=await client.audio.speech.create({model,voice,input:shot.narration,response_format:'wav'});await writeFile(file,Buffer.from(await response.arrayBuffer()));}
      const info=await probe(file);if(!info.hasAudio||info.duration>35)throw Error('Editorial shot narration exceeds 35 seconds; split its content into another shot');
      return {file,duration:Math.ceil((info.duration+.16)*24)/24};
    }));
    timings.speechMs=Math.round(performance.now()-voiceStart);
    const duration=speech.reduce((n,s)=>n+s.duration,0),music=await synthesizeMusic(path.join(dir,'music.wav'),duration);
    const animationStart=performance.now();
    const animation=await captureEditorial(plan,speech.map(s=>s.duration),input.sources[0]?.title||input.name,dir);
    await store.write(id,'layout.json',animation.layoutReport);timings.animationMs=Math.round(performance.now()-animationStart);
    const cues=captionCues(plan.shots,speech.map(s=>s.duration)),ass=path.join(dir,'captions.ass');await writeFile(ass,captionsAss(cues));
    const filter=ass.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
    const ff=await binary('ffmpeg'),output=path.join(dir,'video.mp4'),renderStart=performance.now();
    const voices=speech.map((s,i)=>`[${i+1}:a]apad,atrim=duration=${s.duration},asetpts=PTS-STARTPTS[a${i}]`).join(';');
    await run(ff,['-y','-v','error','-framerate',String(animation.fps),'-i',animation.pattern,...speech.flatMap(s=>['-i',s.file]),'-i',music.file,'-filter_complex_threads','2','-filter_complex',`${voices};${speech.map((_,i)=>`[a${i}]`).join('')}concat=n=${speech.length}:v=0:a=1[voice];[0:v]fps=30,subtitles=filename='${filter}'[v];[${speech.length+1}:a]volume=0.07[bed];[voice][bed]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`,'-map','[v]','-map','[a]','-c:v','libx264','-threads','2','-preset','ultrafast','-crf','20','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','160k','-t',String(duration),'-movflags','+faststart',output],90000);
    await run(ff,['-y','-v','error',...speech.flatMap(s=>['-i',s.file]),'-filter_complex',`${speech.map((s,i)=>`[${i}:a]apad,atrim=duration=${s.duration},asetpts=PTS-STARTPTS[p${i}]`).join(';')};${speech.map((_,i)=>`[p${i}]`).join('')}concat=n=${speech.length}:v=0:a=1[a]`,'-map','[a]',path.join(dir,'narration.wav')],15000);
    timings.encodeMs=Math.round(performance.now()-renderStart);
    const qa=await inspect(output,{width:1080,height:1920,fps:30,duration});if(!qa.hasAudio||qa.audioCodec!=='aac')throw Error('Editorial output requires AAC audio');
    const stamp=(n:number)=>new Date(Math.round(n*1000)).toISOString().slice(11,23);
    await writeFile(path.join(dir,'captions.vtt'),'WEBVTT\n\n'+cues.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.replace(/[<>]/g,'')}\n`).join('\n'));
    const base=`videos/${input.id}/${input.version}/${EDITORIAL_REVISION}`;
    const refs=uploader?[
      await uploader.upload(output,`${base}/short.mp4`,'video/mp4'),await uploader.upload(path.join(dir,'captions.vtt'),`${base}/short.vtt`,'text/vtt'),
      await uploader.upload(path.join(dir,'narration.wav'),`${base}/narration.wav`,'audio/wav'),await uploader.upload(music.file,`${base}/music.wav`,'audio/wav'),
    ]:[output,path.join(dir,'captions.vtt'),path.join(dir,'narration.wav'),music.file];
    if(await checksum(output)!==qa.sha256)throw Error('Editorial media changed after QA');
    const elapsedMs=Math.round(performance.now()-start);await store.write(id,'qa.json',{...qa,timings,elapsedMs,includesUpload:!!uploader,revision:EDITORIAL_REVISION});
    console.log(JSON.stringify({event:'editorial_short_ready',directory:dir,elapsedMs,timings}));
    return {media_ref:refs[0],caption_ref:refs[1],narration_ref:refs[2],music_ref:refs[3],music_provenance:music.provenance,duration_seconds:duration,script:plan,promptRevision:EDITORIAL_REVISION,directory:dir,elapsedMs};
  });
}
type zCoverage={missing_points:string[];unsupported_claims:string[];visual_misrepresentations:string[]};
