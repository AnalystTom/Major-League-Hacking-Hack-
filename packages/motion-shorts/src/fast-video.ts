import OpenAI from 'openai';
import {z} from 'zod';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createProvider} from './provider';
import {inputSchema,validateEvidence,type Technique} from './contracts';
import {binary,run,probe,inspect,checksum} from './media';
import {hash,LocalStore} from './storage';
import {synthesizeMusic} from './music';
import {mediaObjectKeys} from './ingestion';
import type {MediaUploader} from './delivery';
import type {ReadyVideo} from './worker';
import {visualSchema,diagramSvg,captionCues,captionsAss,escapeHtml,routesFor} from './visual-language';

import {MOTION_GRAPHIC_GUIDANCE,MOTION_SKILL_REVISION} from './motion-guidance';
import {sourceStyle} from './source-style';
import {captureAnimation} from './animated-scenes';
export const FAST_REVISION='resurface-connected-v7';
export const fastScriptSchema=z.object({
  title:z.string().min(1).max(52),
  beats:z.array(z.object({
    label:z.string().min(1).max(18),
    focus_node:z.number().int().min(0).max(2),
    headline:z.string().min(1).max(52),
    detail:z.string().min(1).max(100),
    narration:z.string().min(1).max(200),
    evidence_ids:z.array(z.string()).min(1),
    visual:visualSchema,
  })).length(3),
});
export type FastScript=z.infer<typeof fastScriptSchema>;
export function validateFastScript(input:Technique,script:FastScript){
  fastScriptSchema.parse(script);
  for(const beat of script.beats){validateEvidence(input,beat.evidence_ids,true);routesFor(beat.visual);}
  const words=script.beats.reduce((n,b)=>n+b.narration.split(/\s+/).length,0);
  if(words>75)throw new Error('Fast narration must be at most 75 words');
  return script;
}
export function sceneHtml(script:FastScript,index:number,source:string,sourceIdentity=source){
  const beat=script.beats[index],style=sourceStyle(sourceIdentity);
  const diagram=diagramSvg(beat.visual,beat.focus_node).replaceAll('#D1EEA2',style.accent).replaceAll('#193237',style.surface).replaceAll('#476267',style.line).replaceAll('#A9BDB6',style.muted).replaceAll('#809893',style.line);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;width:1080px;height:1920px;background:${style.background};color:#F3F1E8;font-family:Arial,sans-serif;overflow:hidden}
  main{height:100%;position:relative;background:${style.background};box-shadow:inset 0 12px ${style.accent}}
  header{position:absolute;top:46px;left:82px;right:82px;display:flex;justify-content:space-between;align-items:center;font-size:25px;letter-spacing:6px;color:#D1EEA2}header span{color:#8FAAA8;font-size:20px;letter-spacing:2px}
  .source-title{position:absolute;top:104px;left:82px;right:82px;height:104px;overflow:hidden;font-size:38px;line-height:1.25;font-weight:600;color:${style.accent}}
  .eyebrow{position:absolute;top:248px;left:82px;font-size:23px;letter-spacing:4px;color:#8FAAA8;text-transform:uppercase}
  h1{position:absolute;top:296px;left:82px;right:82px;height:216px;margin:0;font-size:80px;line-height:1.08;font-weight:700;letter-spacing:-3px;overflow-wrap:break-word}
  .diagram{position:absolute;left:82px;top:540px;width:916px;height:880px}.diagram svg{width:100%;height:100%}
  .caption-rule{position:absolute;left:150px;right:150px;top:1540px;border-top:1px solid #476267}
  footer{position:absolute;bottom:78px;left:82px;right:82px;display:flex;justify-content:space-between;gap:30px;font-size:19px;color:#8FAAA8}.source{max-width:620px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  </style></head><body><main><header>RESURFACE<span>SOURCE EXPLAINED</span></header>
  <div class="source-title">${escapeHtml(source)}</div><div class="eyebrow">0${index+1} / ${escapeHtml(beat.label.replace(/^\s*\d+[.)\s:-]+/,''))}</div><h1>${escapeHtml(beat.headline)}</h1>
  <div class="diagram">${diagram}</div><div class="caption-rule"></div>
  <footer><span class="source">${escapeHtml(source)}</span><span>AI VOICE ? SOURCE-BACKED</span></footer></main></body></html>`;
}
export async function renderFastShort(input:Technique,root:string,uploader?:MediaUploader):Promise<ReadyVideo & {directory:string;elapsedMs:number}>{
  input=inputSchema.parse(input);
  if(input.mode==='preview')throw new Error('Fast production requires sourced evidence');
  const start=performance.now(),timings:Record<string,number>={};
  const store=new LocalStore(root),id=`fast-${hash({input,revision:FAST_REVISION}).slice(0,24)}`;
  return store.withLock(id,async()=>{
    const dir=store.directory(id);await mkdir(dir,{recursive:true});
    await store.write(id,'input.json',input);
    let script:FastScript;
    try{script=validateFastScript(input,fastScriptSchema.parse(JSON.parse(await readFile(path.join(dir,'script.json'),'utf8'))));}
    catch(e){
      if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
      const provider=createProvider();
      const result=await provider.generate('fast_short',fastScriptSchema,{input,designGuidance:MOTION_GRAPHIC_GUIDANCE,task:'Write a premium 20-30 second educational short from this already-digested text. Exactly three beats: compelling hook, concrete mechanism, actionable takeaway with any necessary caveat. Total spoken narration 45-65 words (hard max 75). Each beat headline <= 40 characters, detail <= 90 characters, label <= 18 characters. Use punchy natural sentences and plain language. No filler, invented benefits, or marketing. Preserve uncertainty from processed_text. Cite provided evidence IDs in evidence_ids only, NEVER speak IDs. The three labels identify the topic-specific beats, not generic steps. Headlines should be meaningful and readable on a phone. For EVERY beat choose a diagram: flow for a process, loop for feedback, comparison for alternatives sharing an input, containment for an isolated component and its external connections. Supply exactly three concrete actors or objects as nodes, each with a short label and the appropriate icon. Links are explicit directed edges with zero-based from/to node indices, a short verb or object label, and kind transfer or observe. Use observe (dashed) for monitoring. Do NOT route communication through a watcher unless the source says it relays it: connect the sender directly to its destination, and the observer separately to the watched actor. A loop needs a return edge. Link labels describe what travels or changes, not repeated node names. Keep the same named actors, node order, diagram kind and positions across beats of one mechanism. Set focus_node to the actor most relevant to the narrated action in that beat. Narration is one continuous explanation, not three disconnected summaries. Follow a specific source-supported action through the system, then show the result and a concise caveat. Avoid meta-phrases like serving as a described relay. Diagram arrows MUST express relationships actually supported by the source, never imply invented causation or a fake workflow. Explain caveats in narration. No generic step cards, abstract labels such as Understand or Apply, slogan headlines, or duplicate numbered labels. Maximum 6 headline words. The visual should explain the mechanism without needing a paragraph. Select geometry from the actual mechanism: loop for iterative interviews or feedback, comparison for alternatives, containment only for actual isolation or boundaries, flow for sequential transformations. Use recognizable tool and project names from the source when supplied, not generic Agent/Input/Result labels. Name the specific topic in the opening headline. Do not default every topic to a three-step workflow.'});
      script=validateFastScript(input,result.value);
      await store.write(id,'script.json',script);await store.write(id,'script-provenance.json',{model:provider.model,requestId:result.requestId,usage:result.usage,skillRevision:MOTION_SKILL_REVISION,revision:FAST_REVISION});
    }
    timings.scriptMs=Math.round(performance.now()-start);
    const client=new OpenAI({maxRetries:0,timeout:30000});
    const voice=process.env.OPENAI_TTS_VOICE||'coral',model=process.env.OPENAI_TTS_MODEL||'gpt-4o-mini-tts';
    const preparationStart=performance.now();
    const speech=await Promise.all(script.beats.map(async(beat,i)=>{
        const file=path.join(dir,`voice-${hash({text:beat.narration,voice,model}).slice(0,16)}.wav`);
        try{await readFile(file);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const response=await client.audio.speech.create({model,voice,input:beat.narration,response_format:'wav'});await writeFile(file,Buffer.from(await response.arrayBuffer()));}
        const info=await probe(file);if(!info.hasAudio||info.duration>15)throw new Error(`Beat ${i+1} speech invalid or too long`);
        return {file,duration:Math.ceil((info.duration+.18)*24)/24};
      }));
    timings.speechAndDesignMs=Math.round(performance.now()-preparationStart);
    const duration=speech.reduce((sum,b)=>sum+b.duration,0);
    const music=await synthesizeMusic(path.join(dir,'music.wav'),duration);
    const ff=await binary('ffmpeg');
    const animationStart=performance.now();
    const animation=await captureAnimation(dir,script.beats.map((beat,i)=>({html:sceneHtml(script,i,input.sources[0]?.title||input.name,input.sources[0]?.url||input.id),duration:speech[i].duration,focus:beat.focus_node})));
    timings.animationMs=Math.round(performance.now()-animationStart);
    const renderStart=performance.now();
    const imageArgs=['-framerate',String(animation.fps),'-i',animation.pattern];
    const cues=captionCues(script.beats,speech.map(b=>b.duration));
    const ass=path.join(dir,'captions.ass');await writeFile(ass,captionsAss(cues));
    const assFilter=ass.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
    const filters=speech.map((b,i)=>`[${i+1}:a]apad,atrim=duration=${b.duration},asetpts=PTS-STARTPTS[a${i}]`).join(';');
    const output=path.join(dir,'video.mp4');
    await run(ff,['-y','-v','error',...imageArgs,...speech.flatMap(b=>['-i',b.file]),'-i',music.file,'-filter_complex_threads','2','-filter_complex',`${filters};[a0][a1][a2]concat=n=3:v=0:a=1[voice];[0:v]fps=30,subtitles=filename='${assFilter}'[v];[4:a]volume=0.10[bed];[voice][bed]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`,'-map','[v]','-map','[a]','-c:v','libx264','-threads','2','-preset','ultrafast','-crf','22','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','160k','-t',String(duration),'-movflags','+faststart',output],60000);
    await run(ff,['-y','-v','error',...speech.flatMap(b=>['-i',b.file]),'-filter_complex',`${speech.map((b,i)=>`[${i}:a]apad,atrim=duration=${b.duration},asetpts=PTS-STARTPTS[p${i}]`).join(';')};[p0][p1][p2]concat=n=3:v=0:a=1[a]`,'-map','[a]',path.join(dir,'narration.wav')],15000);
    timings.renderMs=Math.round(performance.now()-renderStart);
    const qa=await inspect(output,{width:1080,height:1920,fps:30,duration});if(!qa.hasAudio||qa.audioCodec!=='aac')throw new Error('Fast output requires AAC audio');
    const stamp=(n:number)=>new Date(Math.round(n*1000)).toISOString().slice(11,23);
    await writeFile(path.join(dir,'captions.vtt'),'WEBVTT\n\n'+cues.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.replace(/[<>]/g,'')}\n`).join('\n'));
    const keys=mediaObjectKeys(input),base=`videos/${input.id}/${input.version}/${FAST_REVISION}`;
    keys.video=`${base}/short.mp4`;keys.captions=`captions/${input.id}/${input.version}/${FAST_REVISION}/short.vtt`;
    const refs=uploader?[
      await uploader.upload(output,keys.video,'video/mp4'),await uploader.upload(path.join(dir,'captions.vtt'),keys.captions,'text/vtt'),
      await uploader.upload(path.join(dir,'narration.wav'),`${base}/narration.wav`,'audio/wav'),await uploader.upload(music.file,`${base}/music.audio`,'audio/wav'),
    ]:[output,path.join(dir,'captions.vtt'),path.join(dir,'narration.wav'),music.file];
    if(await checksum(output)!==qa.sha256)throw new Error('Media changed after verification');
    const elapsedMs=Math.round(performance.now()-start);
    await store.write(id,'qa.json',{...qa,timings,elapsedMs,includesUpload:!!uploader,skillRevision:MOTION_SKILL_REVISION,revision:FAST_REVISION});
    console.log(JSON.stringify({event:'fast_short_ready',directory:dir,elapsedMs,timings}));
    return {media_ref:refs[0],caption_ref:refs[1],narration_ref:refs[2],music_ref:refs[3],music_provenance:music.provenance,duration_seconds:duration,script,directory:dir,elapsedMs};
  });
}
