import {copyFile,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {inputSchema,validatePlan,descriptionInput,type Technique,type Plan} from './contracts';
import {LocalStore,hash} from './storage';
import {generateCreative,createProvider,PROMPT_VERSION,getOpenAIModel,OPUS_MODEL,type CreativeProvider,type CreativeResult} from './provider';
import {renderVideo,productionConfig,validateConfig,type RenderConfig} from './renderer';
import {inspect,previews,writeCaptions,blackSegments,checksum} from './media';
import {mixAudio,type AudioInput} from './audio';
export type State='pending'|'generating'|'planned'|'rendering'|'validating'|'awaiting_review'|'approved'|'published'|'failed';
const transitions:Record<State,State[]>={pending:['generating','planned','failed'],generating:['planned','failed'],planned:['rendering','failed'],rendering:['validating','failed'],validating:['awaiting_review','failed'],awaiting_review:['approved','rendering','failed'],approved:['published','rendering','failed'],published:['rendering','failed'],failed:['generating','planned','rendering','failed']};
export function assertTransition(from:State,to:State){if(!transitions[from].includes(to))throw new Error(`Invalid job transition ${from} -> ${to}`);}
export type Job={id:string;techniqueId:string;inputVersion:string;projectContextVersion?:string;state:State;mode:Technique['mode'];origin:'fixture'|'openai'|'opus'|'manual';model:string|null;promptVersion:string;config:RenderConfig;createdAt:string;updatedAt:string;error?:string;renderMs?:number;qa?:Awaited<ReturnType<typeof inspect>>;audio?:Awaited<ReturnType<typeof mixAudio>>;approval?:{reviewer:string;note:string;at:string;sha256:string;planHash:string};publication?:{videoUrl:string;captionUrl:string;thumbnailUrl:string;at:string};history:{state:State;at:string}[]};
export const log=(event:string,data:Record<string,unknown>={})=>console.log(JSON.stringify({at:new Date().toISOString(),event,...data}));
export class Pipeline{
  constructor(public store=new LocalStore()){}
  async get(id:string){return this.store.read<Job>(id,'job.json');}
  async transition(job:Job,state:State){assertTransition(job.state,state);job.state=state;job.updatedAt=new Date().toISOString();job.history.push({state,at:job.updatedAt});await this.store.write(job.id,'job.json',job);log('state',{id:job.id,state});}
  async create(raw:unknown,config=productionConfig,origin:Job['origin']=process.env.OPENAI_API_KEY?'openai':'opus',plan?:Plan){
    const input=inputSchema.parse(raw);validateConfig(config);
    const id=`clip-${hash({input,config,origin,plan,model:origin==='opus'?OPUS_MODEL:origin==='openai'?getOpenAIModel():null,prompt:PROMPT_VERSION,renderer:'1'}).slice(0,24)}`;
    await this.store.withLock(id,async()=>{
      try{await this.get(id);return;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      const now=new Date().toISOString();const job:Job={id,techniqueId:input.id,inputVersion:input.version,projectContextVersion:input.project_context_version,state:'pending',mode:input.mode,origin,model:origin==='opus'?OPUS_MODEL:origin==='openai'?getOpenAIModel():null,promptVersion:PROMPT_VERSION,config,createdAt:now,updatedAt:now,history:[{state:'pending',at:now}]};
      await this.store.write(id,'input.json',input);await this.store.write(id,'job.json',job);
      if(plan){await this.store.write(id,'animation.json',validatePlan(input,plan));await this.transition(job,'planned');}
    });return this.get(id);
  }
  async generate(id:string,provider?:CreativeProvider,stopAfter?:'brief'|'storyboard'){
    return this.store.withLock(id,async()=>{
      const job=await this.get(id);if(!['pending','failed','generating'].includes(job.state))return job;
      try{
        if(job.state!=='generating')await this.transition(job,'generating');
        const input=inputSchema.parse(await this.store.read(id,'input.json'));
        const result=await generateCreative(input,this.store.directory(id),provider??createProvider(),stopAfter);
        if(stopAfter)return result;
        const creative=result as CreativeResult;job.model=creative.model;delete job.error;await this.transition(job,'planned');return job;
      }catch(e){job.error=safeError(e);await this.transition(job,'failed');throw e;}
    });
  }
  async render(id:string,audio?:AudioInput){
    // A package-wide exclusive worker lock also bounds concurrency across CLI processes.
    return this.store.withLock('render-worker',()=>this.store.withLock(id,async()=>{
      const job=await this.get(id);
      try{
        const input=inputSchema.parse(await this.store.read(id,'input.json'));const plan=validatePlan(input,await this.store.read(id,'animation.json'));
        delete job.approval;delete job.publication;delete job.qa;delete job.audio;delete job.error;
        await this.transition(job,'rendering');
        const dir=this.store.directory(id);const result=await renderVideo(plan,dir,job.config,input.mode==='preview'||job.origin==='fixture',!!audio);job.renderMs=result.renderMs;
        if(audio){job.audio=await mixAudio(dir,audio,plan.duration);await copyFile(path.join(dir,'with-audio.mp4'),path.join(dir,'video.mp4'));}
        await this.transition(job,'validating');
        job.qa=await inspect(result.output,{...job.config,duration:plan.duration});
        const black=await blackSegments(result.output);if(black.length)throw new Error('Extended black segment detected');
        await writeCaptions(plan,dir);await previews(result.output,dir,plan.duration);
        await this.store.write(id,'qa.json',{...job.qa,blackSegments:black,layout:'schema safe-zone/text estimates passed',artisticQuality:'requires human review',captionAlignment:audio?'requires human listening review':'timed explanatory captions',renderMs:job.renderMs});
        await this.transition(job,'awaiting_review');return job;
      }catch(e){job.error=safeError(e);await this.transition(job,'failed');throw e;}
    }));
  }
  async approve(id:string,reviewer:string,note:string){return this.store.withLock(id,async()=>{
    if(!reviewer.trim()||!note.trim())throw new Error('Record the actual human reviewer and review note');
    const job=await this.get(id);if(job.state!=='awaiting_review'||!job.qa)throw new Error('Only validated renders awaiting review can be approved');
    const sha=await checksum(this.store.file(id,'video.mp4'));if(sha!==job.qa.sha256)throw new Error('Video changed after QA');
    const input=inputSchema.parse(await this.store.read(id,'input.json'));const plan=validatePlan(input,await this.store.read(id,'animation.json'));
    job.approval={reviewer:reviewer.trim(),note:note.trim(),at:new Date().toISOString(),sha256:sha,planHash:hash(plan)};await this.transition(job,'approved');return job;
  });}
  async publish(id:string,base:string,currentInput:unknown){return this.store.withLock(id,async()=>{
    const job=await this.get(id);const input=inputSchema.parse(await this.store.read(id,'input.json'));const current=inputSchema.parse(currentInput);
    const plan=validatePlan(input,await this.store.read(id,'animation.json'));
    if(hash(input)!==hash(current))throw new Error('Current ingestion record differs; regenerate/review against current evidence');
    if(job.state!=='approved'||!job.approval||!job.qa||!job.audio||!job.qa.hasAudio)throw new Error('Publication requires validated media, human approval, narration and licensed music');
    if(input.mode!=='reviewed'||(job.origin!=='opus'&&job.origin!=='openai')||(job.origin==='opus'&&job.model!==OPUS_MODEL)||(job.origin==='openai'&&job.model!==getOpenAIModel()))throw new Error('Only live AI generation from reviewed evidence can be published');
    if(job.approval.planHash!==hash(plan)||job.approval.sha256!==await checksum(this.store.file(id,'video.mp4')))throw new Error('Approved artifacts changed');
    const url=new URL(base);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.protocol!=='http:'||url.pathname!=='/'||url.username||url.password)throw new Error('Built-in publication supports a running loopback media server only; production requires an object-storage adapter');
    const health=await fetch(new URL('/health',url),{signal:AbortSignal.timeout(5000)});const identity=await health.json() as {storeId?:string};
    if(identity.storeId!==hash(this.store.root))throw new Error('Media server is serving a different artifact store');
    for(const name of ['video.mp4','captions.vtt','frame-1.png']){const local=this.store.file(id,name);await stat(local);const response=await fetch(new URL(`/media/${id}/${name}`,url),{method:'HEAD',signal:AbortSignal.timeout(5000)});if(!response.ok||Number(response.headers.get('content-length'))!==(await stat(local)).size)throw new Error(`Media endpoint cannot serve ${name}`);}
    job.publication={videoUrl:new URL(`/media/${id}/video.mp4`,url).href,captionUrl:new URL(`/media/${id}/captions.vtt`,url).href,thumbnailUrl:new URL(`/media/${id}/frame-1.png`,url).href,at:new Date().toISOString()};await this.transition(job,'published');return job;
  });}
  async fixture(plan:Plan,config:RenderConfig){const input=descriptionInput(`Hand-authored development fixture: ${plan.title}`);const job=await this.create(input,config,'fixture',plan);if(job.state==='awaiting_review')return job;return this.render(job.id);}
}
export function safeError(e:unknown){const value=e instanceof Error?e.message:String(e);return value.replace(/sk-[\w-]+/g,'[REDACTED]').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0,3000);}
export async function readJson(file:string):Promise<unknown>{const bytes=await stat(file);if(bytes.size>2_000_000)throw new Error('Input exceeds 2MB');return JSON.parse(await readFile(file,'utf8'));}
