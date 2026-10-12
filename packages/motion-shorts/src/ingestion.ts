import {z} from 'zod';
import {inputSchema,type Technique} from './contracts';

// Boundary for PR #2's StoredArtifact plus contributing ingested_units rows.
// Sources in StoredArtifact have no IDs and PostgreSQL does not preserve their
// order, so resolve source IDs through the unit records, never by array index.
export const ingestionBundleSchema=z.object({
  artifact:z.object({
    id:z.uuid(),version:z.number().int().positive(),name:z.string(),category:z.string(),processed_text:z.string(),
    source_ids:z.array(z.uuid()).min(1),
    evidence:z.array(z.object({source_id:z.uuid(),start_seconds:z.number().int().nonnegative(),end_seconds:z.number().int().nonnegative(),passage:z.string().min(1)})).min(1),
    ingestion_status:z.literal('ready'),review_status:z.enum(['pending','approved','rejected']),
    project_context_id:z.uuid().nullable(),project_context_version:z.number().int().positive().nullable(),
    selection_reason:z.string().optional(),
  }),
  units:z.array(z.object({id:z.uuid(),source_url:z.url(),title:z.string().nullable(),status:z.literal('ready')})),
});
export function adaptIngestionArtifact(raw:unknown):Technique{
  const {artifact:a,units}=ingestionBundleSchema.parse(raw);
  const byId=new Map(units.map(unit=>[unit.id,unit]));
  if(byId.size!==units.length)throw new Error('Duplicate ingestion unit IDs');
  if((a.project_context_id===null)!==(a.project_context_version===null))throw new Error('Project ID and version must both be present or null');
  return inputSchema.parse({
    ...a,version:String(a.version),mode:'sourced',
    project_context_id:a.project_context_id??undefined,project_context_version:a.project_context_version===null?undefined:String(a.project_context_version),
    editorial_notes:a.selection_reason,
    sources:a.source_ids.map(id=>{const unit=byId.get(id);if(!unit)throw new Error(`Missing source unit: ${id}`);return {id,url:unit.source_url,title:unit.title};}),
    evidence:a.evidence.map((e,i)=>{
      if(e.end_seconds<e.start_seconds)throw new Error('Evidence end precedes start');
      return {id:`evidence-${i+1}`,source_id:e.source_id,excerpt:e.passage,timestamp:`${e.start_seconds}..${e.end_seconds}s`};
    }),
  });
}
export function mediaObjectKeys(input:Technique){
  const id=z.uuid().parse(input.id);const version=z.coerce.number().int().positive().parse(input.version);
  return {video:`videos/${id}/${version}/short.mp4`,captions:`captions/${id}/${version}/short.vtt`,poster:`posters/${id}/${version}/poster.jpg`};
}
