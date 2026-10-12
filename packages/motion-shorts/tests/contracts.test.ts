import {describe,it,expect} from 'vitest';
import {descriptionInput,inputSchema,planSchema,validatePlan} from '../src/contracts';
import {feedbackFixture,orchestrationFixture} from '../src/fixtures';
import {frameCount,valueAt} from '../src/motion';
import {captionsVtt} from '../src/media';
import {assertTransition,safeError} from '../src/jobs';
import {hash,LocalStore} from '../src/storage';
export const reviewed=()=>inputSchema.parse({id:'technique',version:'1',name:'Feedback',category:'Agent workflows',processed_text:'Inspect failures before revising.',mode:'reviewed',source_ids:['source'],sources:[{id:'source',url:'https://example.com/source',title:'Test-only source'}],evidence:[{id:'evidence',source_id:'source',excerpt:'Test-only evidence'}],ingestion_status:'ready',review_status:'approved'});
describe('input and evidence boundaries',()=>{
  it('description has no invented evidence or approval',()=>{const input=descriptionInput('Explain verification');expect(input.mode).toBe('preview');expect(input.evidence).toEqual([]);expect(input.review_status).toBe('pending');});
  it('requires approval and ready status for reviewed material',()=>{expect(()=>inputSchema.parse({...reviewed(),review_status:'pending'})).toThrow();expect(()=>inputSchema.parse({...reviewed(),ingestion_status:'failed'})).toThrow();});
  it('rejects unknown sources and empty reviewed evidence',()=>{expect(()=>inputSchema.parse({...reviewed(),evidence:[]})).toThrow();expect(()=>inputSchema.parse({...reviewed(),source_ids:['missing']})).toThrow();});
  it('requires known scene and caption evidence',()=>{expect(()=>validatePlan(reviewed(),feedbackFixture())).toThrow(/Evidence required/);const plan=feedbackFixture();plan.scenes[0].evidence_ids=['fake'];expect(()=>validatePlan(reviewed(),plan)).toThrow(/Unknown evidence/);});
});
describe('motion and layout',()=>{
  it('accepts two distinct valid fixture compositions',()=>{expect(planSchema.parse(feedbackFixture()).elements.length).toBeGreaterThan(10);expect(orchestrationFixture().elements.map(e=>e.id)).not.toEqual(feedbackFixture().elements.map(e=>e.id));});
  it('rejects non-monotonic and out-of-range keyframes',()=>{const p=feedbackFixture();p.elements[2].tracks[0].keyframes[1].time=0;expect(()=>planSchema.parse(p)).toThrow(/timing/);});
  it('rejects caption overlap and excessive reading speed',()=>{const p=feedbackFixture();p.captions[1].start=1;expect(()=>planSchema.parse(p)).toThrow();p.captions[1].start=3;p.captions[0].end=0.1;expect(()=>planSchema.parse(p)).toThrow();});
  it('rejects geometry and text outside safe area',()=>{const p=feedbackFixture();p.elements[1].x=50;expect(()=>planSchema.parse(p)).toThrow(/Safe-zone/);const q=feedbackFixture();q.elements[0].text='x'.repeat(100);expect(()=>planSchema.parse(q)).toThrow(/overflow/);});
  it('rejects scene gaps',()=>{const p=feedbackFixture();p.scenes[0].start=1;expect(()=>planSchema.parse(p)).toThrow(/contiguous/);});
  it('interpolates state with deterministic time',()=>{const el=feedbackFixture().elements.find(e=>e.id==='return')!;expect(valueAt(el,'draw',0,1)).toBe(0);expect(valueAt(el,'draw',4.65,1)).toBeCloseTo(0.5);expect(valueAt(el,'draw',10,1)).toBe(1);expect(frameCount(12,30)).toBe(360);});
  it('writes precise WebVTT',()=>{expect(captionsVtt(feedbackFixture())).toContain('00:00:06.600 --> 00:00:09.200');});
});
describe('lifecycle and paths',()=>{
  it('cannot skip QA or approval',()=>{expect(()=>assertTransition('rendering','published')).toThrow();expect(()=>assertTransition('awaiting_review','published')).toThrow();expect(()=>assertTransition('failed','rendering')).not.toThrow();});
  it('rejects path traversal',()=>{const store=new LocalStore();expect(()=>store.directory('../secret')).toThrow();expect(()=>store.file('safe','../secret')).toThrow();expect(()=>store.directory('C:\\private')).toThrow();});
  it('changes cache identity with source version',()=>{expect(hash(reviewed())).not.toBe(hash({...reviewed(),version:'2'}));});
  it('redacts provider keys from persisted errors',()=>{expect(safeError(new Error('sk-ant-secret-123 Bearer abc'))).not.toContain('secret');});
});
