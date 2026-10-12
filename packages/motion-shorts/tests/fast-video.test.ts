import {it,expect} from 'vitest';
import {descriptionInput,inputSchema} from '../src/contracts';
import {validateFastScript,sceneHtml,type FastScript} from '../src/fast-video';
const input=inputSchema.parse({...descriptionInput('A testable mechanism'),mode:'sourced',source_ids:['source-1'],sources:[{id:'source-1',url:'https://example.com',title:'Source'}],evidence:[{id:'evidence-1',source_id:'source-1',excerpt:'Check before proceeding.'}]});
const script:FastScript={title:'Check before proceeding',beats:Array.from({length:3},()=>({label:'Check',focus_node:1,headline:'Check the result',detail:'Only proceed when it passes.',narration:'Check the result before proceeding.',evidence_ids:['evidence-1'],visual:{kind:'flow',nodes:[{label:'Input',icon:'document'},{label:'Check',icon:'check'},{label:'Result',icon:'tool'}],links:[{from:0,to:1,label:'checks',kind:'transfer'},{from:1,to:2,label:'returns',kind:'transfer'}]}}))};
it('requires supplied evidence and bounded narration for fast production',()=>{
  expect(validateFastScript(input,script)).toBe(script);
  expect(()=>validateFastScript(input,{...script,beats:script.beats.map(b=>({...b,evidence_ids:['invented']}))})).toThrow();
  expect(()=>validateFastScript(input,{...script,beats:script.beats.map(b=>({...b,narration:'word '.repeat(30)}))})).toThrow('75 words');
});
it('escapes untrusted text before browser rendering',()=>{
  const html=sceneHtml({...script,beats:script.beats.map(b=>({...b,headline:'<script>alert(1)</script>'}))},0,'<img src=x>');
  expect(html).not.toContain('<script>');expect(html).not.toContain('<img src=x>');
  expect(html).toContain('&lt;script&gt;');expect(html).toContain('AI VOICE');
});

it('identifies the source prominently while preserving separate topic headlines',()=>{
 const html=sceneHtml(script,0,'An original video title');
 expect(html).toContain('<div class="source-title">An original video title</div>');
 expect(html).toContain('<h1>Check the result</h1>');
 expect(html).not.toBe(sceneHtml(script,0,'Another video title'));
});
