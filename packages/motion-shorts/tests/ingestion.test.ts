import {expect,it} from 'vitest';
import {adaptIngestionArtifact,mediaObjectKeys} from '../src/ingestion';
import {validateEvidence} from '../src/contracts';
const source='11111111-1111-4111-8111-111111111111',artifact='22222222-2222-4222-8222-222222222222';
const bundle=()=>({artifact:{id:artifact,version:2,name:'Feedback',category:'Testing',processed_text:'Inspect failures.',source_ids:[source],evidence:[{source_id:source,start_seconds:2,end_seconds:8,passage:'Inspect the test failure.'}],ingestion_status:'ready',review_status:'pending',project_context_id:null,project_context_version:null},units:[{id:source,source_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',title:null,status:'ready'}]});
it('accepts ready ingestion without inventing approval, source title, or project',()=>{
  const input=adaptIngestionArtifact(bundle());expect(input.mode).toBe('sourced');expect(input.review_status).toBe('pending');expect(input.sources[0].title).toBeNull();expect(input.project_context_id).toBeUndefined();expect(input.evidence[0].timestamp).toBe('2..8s');
  expect(mediaObjectKeys(input).video).toBe(`videos/${artifact}/2/short.mp4`);
  expect(()=>validateEvidence(input,[],true)).toThrow('Evidence required');
});
it('rejects absent source mappings and unknown evidence references',()=>{
  const missing=bundle();missing.units=[];expect(()=>adaptIngestionArtifact(missing)).toThrow('Missing source');
  const unknown=bundle();unknown.artifact.evidence[0].source_id=artifact;expect(()=>adaptIngestionArtifact(unknown)).toThrow();
});
it('rejects pending ingestion and invalid timestamp ranges',()=>{
  const pending=bundle();pending.artifact.ingestion_status='pending';expect(()=>adaptIngestionArtifact(pending)).toThrow();
  const invalid=bundle();invalid.artifact.evidence[0].end_seconds=1;expect(()=>adaptIngestionArtifact(invalid)).toThrow('precedes');
});
