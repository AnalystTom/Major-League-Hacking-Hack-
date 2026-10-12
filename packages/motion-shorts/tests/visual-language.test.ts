import {it,expect} from 'vitest';
import {visualSchema,diagramSvg,captionCues,captionsAss,signalPosition} from '../src/visual-language';
it('renders all supported visual structures with escaped source labels',()=>{
  for(const kind of ['flow','loop','comparison','containment'] as const){
    const visual=visualSchema.parse({kind,nodes:[{label:'<img>',icon:'agent'},{label:'Check',icon:'check'},{label:'Website',icon:'web'}],links:[{from:0,to:1,label:'request',kind:'transfer'},{from:1,to:2,label:'result',kind:'transfer'}]});
    expect(diagramSvg(visual,1)).toContain('&lt;img&gt;');expect(diagramSvg(visual,1)).not.toContain('<img>');
    expect(signalPosition(visual,8).y).toContain('mod(t/');
  }
});
it('keeps phrase captions inside actual spoken beat boundaries and escapes ASS controls',()=>{
  const cues=captionCues([{narration:'one two three four five six seven eight nine'},{narration:'Next beat.'}],[6,4]);
  expect(cues).toEqual([{start:0,end:3,text:'one two three four five six seven'},{start:3,end:6,text:'eight nine'},{start:6,end:10,text:'Next beat.'}]);
  expect(captionsAss([{start:0,end:1,text:'{\\pos(0,0)} hello'}])).not.toContain('\\pos');
});

it('does not divide by zero on a same-row comparison connection',()=>{
  const visual=visualSchema.parse({kind:'comparison',nodes:[{label:'Input',icon:'document'},{label:'Left',icon:'tool'},{label:'Right',icon:'tool'}],links:[{from:1,to:2,label:'compare',kind:'transfer'},{from:0,to:1,label:'input',kind:'transfer'}]});
  const position=signalPosition(visual,8);
  expect(position.x).not.toContain('/0*');
  expect(position.y).not.toContain('/0*');
});

it('keeps all four semantic layouts geometrically distinct',()=>{
  const kinds=['flow','loop','comparison','containment'] as const;
  const layouts=kinds.map(kind=>diagramSvg(visualSchema.parse({kind,nodes:[{label:'A',icon:'agent'},{label:'B',icon:'tool'},{label:'C',icon:'document'}],links:[{from:0,to:1,label:'sends',kind:'transfer'},{from:1,to:2,label:'returns',kind:'transfer'}]}),0));
  expect(new Set(layouts).size).toBe(4);
});
