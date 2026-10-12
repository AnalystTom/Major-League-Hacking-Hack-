import {planSchema,type Element,type Plan} from './contracts';
const ink='#EDEDE6',muted='#8D999E',accent='#B9E676',red='#F58B73',panel='#17272E',line='#45606B';
const track=(property:Element['tracks'][number]['property'],pairs:number[][]):Element['tracks'][number]=>({property,keyframes:pairs.map(([time,value])=>({time,value,ease:'smooth'}))});
function element(id:string,kind:Element['kind'],x:number,y:number,width:number,height:number,extra:Partial<Element>={}):Element{return {id,kind,x,y,width,height,text:'',fontSize:28,fill:panel,stroke:line,strokeWidth:0,radius:12,points:[],tracks:[],...extra};}
const text=(id:string,label:string,x:number,y:number,width=560,size=28,extra:Partial<Element>={})=>element(id,'text',x,y,width,size*1.3*label.split('\n').length,{text:label,fontSize:size,fill:ink,...extra});
const path=(id:string,points:number[][],extra:Partial<Element>={})=>element(id,'path',360,500,1,1,{points:points as [number,number][],stroke:line,strokeWidth:3,...extra});
export function feedbackFixture():Plan{
  return planSchema.parse({version:'1',title:'A change is not a result.',subtitle:'THE VERIFICATION LOOP',duration:12,background:'#0D1B22',accent,
    scenes:[{id:'loop',start:0,end:12,purpose:'Show failure changing the next implementation',explanation:'Implement, test, inspect the failure, correct, verify.',transition:'Continuous state change',evidence_ids:[]}],
    elements:[
      text('agent-label','CODING AGENT',360,285,520,24,{fill:muted}),
      element('agent','rect',360,415,540,190,{strokeWidth:1}),
      text('code-old','return items[0]',360,399,460,32,{tracks:[track('opacity',[[0,1],[6.3,1],[6.8,0]])]}),
      text('code-new','return items.at(-1)',360,399,480,32,{fill:accent,tracks:[track('opacity',[[0,0],[6.3,0],[6.8,1]])]}),
      text('revision','IMPLEMENTATION / 01',360,463,480,22,{fill:muted,tracks:[track('opacity',[[0,1],[6.4,1],[6.8,0]])]}),
      text('revision-two','CORRECTION / 02',360,463,480,22,{fill:accent,tracks:[track('opacity',[[0,0],[6.4,0],[6.8,1]])]}),
      path('outbound',[[360,516],[360,669]]),
      text('run','RUN TEST',452,587,190,20,{fill:muted}),
      element('tests','rect',360,768,460,184,{strokeWidth:1}),
      text('expected','last([a, b]) → b',360,731,420,30),
      text('pending','CHECKING…',360,800,370,24,{fill:muted,tracks:[track('opacity',[[0,1],[2.8,1],[3,0]])]}),
      text('failure','RECEIVED a / FAIL',360,800,380,24,{fill:red,tracks:[track('opacity',[[0,0],[2.8,0],[3.1,1],[8.8,1],[9,0]])]}),
      text('pass','RECEIVED b / PASS',360,800,380,24,{fill:accent,tracks:[track('opacity',[[0,0],[8.8,0],[9.1,1]])]}),
      path('return',[[130,768],[66,768],[66,415],[90,415]],{stroke:red,tracks:[track('draw',[[0,0],[3.5,0],[5.8,1]]),track('opacity',[[0,1],[7.5,1],[9,0.25]])]}),
      element('change','circle',360,540,16,16,{fill:accent,tracks:[track('y',[[0,540],[1,540],[2.8,666],[6.9,540],[7.3,540],[8.8,666]]),track('opacity',[[0,0],[0.6,1],[2.8,1],[3,0],[7,0],[7.3,1],[8.8,1],[9,0]])]}),
      text('feedback','OBSERVED FAILURE',360,934,560,24,{fill:red,tracks:[track('opacity',[[0,0],[3.2,0],[3.6,1],[6.5,1],[7,0]])]}),
      text('verified','VERIFY THE CORRECTION',360,934,560,24,{fill:accent,tracks:[track('opacity',[[0,0],[9.1,0],[9.6,1]])]}),
    ],captions:[{start:0,end:3,text:'Make a change. Then test the expected behavior.',evidence_ids:[]},{start:3,end:6.6,text:'Feed the observed failure back into the next change.',evidence_ids:[]},{start:6.6,end:9.2,text:'Correct the implementation. Run the test again.',evidence_ids:[]},{start:9.2,end:12,text:'Verify this behavior before moving on.',evidence_ids:[]}]});
}
export function orchestrationFixture():Plan{
  const reveal=(time:number)=>[track('opacity',[[0,0],[time,0],[time+0.5,1]])];
  return planSchema.parse({version:'1',title:'Parallel work. Shared finish.',subtitle:'DEPENDENCY-AWARE COORDINATION',duration:12,background:'#0D1B22',accent,
    scenes:[{id:'parallel',start:0,end:12,purpose:'Demonstrate a synchronization barrier',explanation:'Split independent work, wait on dependencies, integrate against shared contracts.',transition:'Branch then merge',evidence_ids:[]}],
    elements:[text('contract','ONE SHARED CONTRACT',360,290,570,26),element('root','rect',360,378,260,100,{strokeWidth:1}),text('context','CONTEXT',360,378,240,26),
      path('branch-a',[[310,428],[190,525]],{tracks:[track('draw',[[0,0],[1,0],[2,1]])]}),path('branch-b',[[410,428],[530,525]],{tracks:[track('draw',[[0,0],[1,0],[2,1]])]}),
      element('a','rect',190,600,260,150,{strokeWidth:1,tracks:reveal(1.6)}),element('b','rect',530,600,260,150,{strokeWidth:1,tracks:reveal(1.6)}),
      text('a-title','AGENT A',190,573,240,26,{tracks:reveal(1.6)}),text('b-title','AGENT B',530,573,240,26,{tracks:reveal(1.6)}),
      text('a-task','API',190,624,230,22,{fill:muted,tracks:reveal(2)}),text('b-task','TESTS',530,624,230,22,{fill:muted,tracks:reveal(2)}),
      path('join-a',[[190,675],[190,768],[360,768]],{stroke:accent,tracks:[track('draw',[[0,0],[3,0],[4.5,1]])]}),
      path('join-b',[[530,675],[530,768],[360,768]],{stroke:accent,tracks:[track('draw',[[0,0],[5,0],[7,1]])]}),
      element('gate','circle',360,768,28,28,{fill:accent,tracks:reveal(7)}),
      text('waiting','WAIT FOR BOTH',360,827,500,23,{fill:muted,tracks:[track('opacity',[[0,0],[4,0],[4.5,1],[7,1],[7.4,0]])]}),
      element('integration','rect',360,907,420,112,{strokeWidth:1,tracks:reveal(7.5)}),text('integrate','INTEGRATE + VERIFY',360,907,390,26,{fill:accent,tracks:reveal(7.5)})],
    captions:[{start:0,end:3,text:'Share the contract. Split independent tasks.',evidence_ids:[]},{start:3,end:6,text:'Agents work in parallel; completion times differ.',evidence_ids:[]},{start:6,end:9,text:'Wait until every required dependency is ready.',evidence_ids:[]},{start:9,end:12,text:'Integrate the results, then verify them together.',evidence_ids:[]}]});
}
