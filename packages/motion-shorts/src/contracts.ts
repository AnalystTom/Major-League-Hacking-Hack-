import {z} from 'zod';

export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const text = z.string().trim().min(1);
export const inputSchema = z.object({
  id:idSchema, version:text, name:text.max(100), category:text.max(80), processed_text:text.max(30000),
  source_ids:z.array(idSchema).max(30),
  sources:z.array(z.object({id:idSchema,url:z.url().refine(v=>/^https?:\/\//.test(v),'HTTP(S) source required'),title:text.nullable()})).max(30),
  evidence:z.array(z.object({id:idSchema,source_id:idSchema,excerpt:text.max(6000),timestamp:z.string().optional()})).max(100),
  ingestion_status:z.enum(['pending','running','ready','failed']), review_status:z.enum(['pending','approved','rejected']),
  project_context_id:z.string().optional(),project_context_version:z.string().optional(), editorial_notes:z.string().optional(),
  mode:z.enum(['reviewed','sourced','preview']).default('reviewed'),
}).superRefine((v,c)=>{
  const ids=new Set(v.sources.map(s=>s.id));
  if(ids.size!==v.sources.length || new Set(v.evidence.map(e=>e.id)).size!==v.evidence.length) c.addIssue({code:'custom',message:'Duplicate source/evidence IDs'});
  if(v.source_ids.some(id=>!ids.has(id)) || v.sources.some(s=>!v.source_ids.includes(s.id))) c.addIssue({code:'custom',message:'source_ids must match sources'});
  if(v.evidence.some(e=>!ids.has(e.source_id))) c.addIssue({code:'custom',message:'Evidence references an unknown source'});
  if(v.mode==='reviewed' && (v.ingestion_status!=='ready'||v.review_status!=='approved'||!v.evidence.length)) c.addIssue({code:'custom',message:'Reviewed input requires ready, approved, source-backed evidence'});
  if(v.mode==='sourced' && (v.ingestion_status!=='ready'||!v.evidence.length)) c.addIssue({code:'custom',message:'Sourced input requires ready, source-backed evidence'});
});
export type Technique = z.infer<typeof inputSchema>;
export function descriptionInput(description:string):Technique {
  return inputSchema.parse({id:'description',version:'1',name:'Development preview',category:'Preview',processed_text:description,source_ids:[],sources:[],evidence:[],ingestion_status:'ready',review_status:'pending',mode:'preview'});
}

export const briefSchema=z.object({problem:text,mechanism:text,takeaway:text,caveats:z.array(text),claims:z.array(z.object({id:idSchema,text,evidence_ids:z.array(idSchema)})).min(1).max(20)});
export const scriptSchema=z.object({title:text.max(60),beats:z.array(z.object({id:idSchema,narration:text.max(500),duration:z.number().min(1).max(20),claim_ids:z.array(idSchema)})).min(1).max(12)});
export const strategySchema=z.object({metaphor:text,relationships:text,composition:text,attention:text,transitions:text});
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
const keyframe=z.object({time:z.number().min(0).max(90),value:z.number().finite(),ease:z.enum(['linear','smooth','hold'])});
export const elementSchema=z.object({
  id:idSchema,kind:z.enum(['rect','circle','text','path']),
  x:z.number().min(36).max(684),y:z.number().min(230).max(980),
  width:z.number().min(1).max(648),height:z.number().min(1).max(750),
  text:z.string().max(160),fontSize:z.number().min(20).max(64),
  fill:color,stroke:color,strokeWidth:z.number().min(0).max(8),
  radius:z.number().min(0).max(64),
  points:z.array(z.tuple([z.number().min(36).max(684),z.number().min(230).max(980)])).max(32),
  tracks:z.array(z.object({property:z.enum(['x','y','opacity','scale','rotation','draw']),keyframes:z.array(keyframe).min(1).max(24)})).max(6),
});
export const planSchema=z.object({
  version:z.literal('1'),title:text.max(55),subtitle:text.max(70),duration:z.number().min(3).max(90),
  background:color,accent:color,
  scenes:z.array(z.object({id:idSchema,start:z.number().min(0),end:z.number().max(90),purpose:text,explanation:text,transition:text,evidence_ids:z.array(idSchema)})).min(1).max(12),
  elements:z.array(elementSchema).min(1).max(70),
  captions:z.array(z.object({start:z.number().min(0),end:z.number().max(90),text:text.max(110),evidence_ids:z.array(idSchema)})).min(1).max(40),
}).superRefine((p,c)=>{
  const fail=(message:string)=>c.addIssue({code:'custom',message});
  if(new Set(p.elements.map(e=>e.id)).size!==p.elements.length) fail('Duplicate element IDs');
  let end=0;
  for(const s of p.scenes){if(Math.abs(s.start-end)>0.01||s.end<=s.start||s.end>p.duration)fail('Scenes must be contiguous and cover the timeline');end=s.end;}
  if(Math.abs(end-p.duration)>0.01)fail('Scenes must cover duration');
  end=0;
  for(const cap of p.captions){if(cap.start<end||cap.end<=cap.start||cap.end>p.duration)fail('Invalid caption timing');if(cap.text.length/(cap.end-cap.start)>24)fail('Captions exceed 24 characters/second');end=cap.end;}
  for(const el of p.elements){
    if(el.kind==='path'&&el.points.length<2)fail(`Path ${el.id} needs two points`);
    if(el.kind==='text'){
      const lines=el.text.split('\n');
      if(lines.some(line=>line.length*el.fontSize*0.61>el.width)||lines.length*el.fontSize*1.25>el.height)fail(`Text overflow: ${el.id}`);
    }
    if(new Set(el.tracks.map(t=>t.property)).size!==el.tracks.length)fail(`Duplicate tracks: ${el.id}`);
    for(const t of el.tracks){
      let last=-1;
      for(const k of t.keyframes){
        if(k.time<=last||k.time>p.duration)fail(`Invalid keyframe timing: ${el.id}`);last=k.time;
        if(['opacity','draw'].includes(t.property)&&(k.value<0||k.value>1))fail('Opacity/draw outside 0..1');
        if(t.property==='scale'&&(k.value<0.1||k.value>2))fail('Scale outside 0.1..2');
        if(t.property==='rotation'&&Math.abs(k.value)>360)fail('Rotation outside -360..360');
      }
    }
    if(el.kind!=='path'){
      const xs=el.tracks.find(t=>t.property==='x')?.keyframes.map(k=>k.value)??[el.x];
      const ys=el.tracks.find(t=>t.property==='y')?.keyframes.map(k=>k.value)??[el.y];
      const scale=Math.max(1,...(el.tracks.find(t=>t.property==='scale')?.keyframes.map(k=>k.value)??[]));
      if(xs.some(x=>x-el.width*scale/2<36||x+el.width*scale/2>684)||ys.some(y=>y-el.height*scale/2<230||y+el.height*scale/2>980))fail(`Safe-zone violation: ${el.id}`);
    }
  }
});
export type Plan=z.infer<typeof planSchema>;
export type Element=z.infer<typeof elementSchema>;
export function validateEvidence(input:Technique,refs:string[],required=false){
  if(required&&input.mode!=='preview'&&!refs.length)throw new Error('Evidence required for every published claim/scene/caption');
  const known=new Set(input.evidence.map(e=>e.id));
  if(refs.some(id=>!known.has(id)))throw new Error('Unknown evidence reference');
}
export function validatePlan(input:Technique,raw:unknown):Plan{
  const p=planSchema.parse(raw);
  for(const s of [...p.scenes,...p.captions])validateEvidence(input,s.evidence_ids,true);
  return p;
}
