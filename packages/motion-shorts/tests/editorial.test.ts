import {it,expect} from 'vitest';
import {descriptionInput,inputSchema} from '../src/contracts';
import {validateEditorialPlan,type EditorialPlan} from '../src/editorial-plan';
import {editorialHtml,editorialFrame} from '../src/editorial-stage';
const input=inputSchema.parse({...descriptionInput('A mechanism and its limitation'),mode:'sourced',source_ids:['s'],sources:[{id:'s',url:'https://example.com',title:'Source'}],evidence:[{id:'e',source_id:'s',excerpt:'A mechanism with a limitation.'}]});
const plan:EditorialPlan={title:'Specific explanation',art_direction:'Paper documents become a sequence of actual decisions.',content_points:[{id:'mechanism',point:'Explain mechanism',evidence_ids:['e']},{id:'caveat',point:'Keep limitation',evidence_ids:['e']}],shots:['editorial','closeup','demonstration','conclusion'].map((composition,i)=>({id:String(i),purpose:'Show a specific point',composition:composition as EditorialPlan['shots'][number]['composition'],narration:'A mechanism has a limitation.',point_ids:i===3?['caveat']:['mechanism'],evidence_ids:['e'],background:'#FFFFFF',accent:'#FF8800',ink:'#000000',elements:[0,1].map(j=>({id:String(j),kind:'panel' as const,x:60,y:200+j*300,width:600,height:240,text:'Specific idea',fontSize:90,font:'sans' as const,fill:'#FFFFFF',ink:'#000000',motion:'travel' as const,delay:0,span:.2,dx:120,dy:0}))}))};
it('requires every declared material point and caveat in a shot',()=>{
 expect(validateEditorialPlan(input,plan)).toEqual(plan);
 expect(()=>validateEditorialPlan(input,{...plan,shots:plan.shots.map(s=>({...s,point_ids:['mechanism']}))})).toThrow('omits');
});
it('rejects invented evidence, off-canvas geometry and repeated composition',()=>{
 expect(()=>validateEditorialPlan(input,{...plan,shots:plan.shots.map(s=>({...s,evidence_ids:['invented']}))})).toThrow();
 expect(()=>validateEditorialPlan(input,{...plan,shots:plan.shots.map(s=>({...s,elements:s.elements.map(e=>({...e,x:800}))}))})).toThrow('safe area');
 expect(()=>validateEditorialPlan(input,{...plan,shots:plan.shots.map(s=>({...s,composition:'editorial'}))})).toThrow('distinct');
});
it('renders escaped source and copy without executing supplied markup',()=>{
 const altered={...plan,shots:plan.shots.map(s=>({...s,elements:s.elements.map(e=>({...e,text:'<script>alert(1)</script>'}))}))};
 const html=editorialHtml(altered,0,'<img src=x>');
 expect(html).not.toContain('<script>');expect(html).not.toContain('<img src=x>');expect(html).toContain('&lt;script&gt;');
});

it('preserves the previous terminal position and visibility across a match cut',()=>{
 const start=editorialFrame(plan,1,0,5)[0];
 expect(start.x).toBe(180);expect(start.opacity).toBe(1);
 const end=editorialFrame(plan,1,5,5)[0];expect(end.x).toBe(180);
 const changed=structuredClone(plan);changed.shots[1].elements[0].x=300;
 expect(editorialFrame(changed,1,0,5)[0].x).toBe(180);
 expect(editorialFrame(changed,1,5,5)[0].x).toBe(420);
 expect(editorialFrame(changed,1,.3,5)).toEqual(editorialFrame(changed,1,.3,5));
});
it('rejects disconnected slides and static-only staging',()=>{
 const disconnected=structuredClone(plan);disconnected.shots.forEach((s,i)=>s.elements.forEach(e=>e.id+=i));
 expect(()=>validateEditorialPlan(input,disconnected)).toThrow('adjacent');
 const staticPlan=structuredClone(plan);staticPlan.shots.forEach(s=>s.elements.forEach(e=>e.motion='hold'));
 expect(()=>validateEditorialPlan(input,staticPlan)).toThrow('meaningful object action');
});

it('renders detailed animated props without accepting executable source markup',async()=>{
 const {illustratedProp,propActivity}=await import('../src/editorial-props');
 const object={...plan.shots[0].elements[0],kind:'observer' as const,text:'<script>bad</script>'};
 const svg=illustratedProp(object);expect(svg).toContain('data-watch');expect(svg).not.toContain('<script>');
 expect(propActivity(2)).toEqual(propActivity(2));expect(propActivity(2).flow).not.toBe(propActivity(3).flow);
 expect(svg).not.toMatch(/<animate|<script|onload=/);
});
