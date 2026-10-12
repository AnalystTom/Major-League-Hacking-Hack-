import {z} from 'zod';

export const visualSchema=z.object({
  kind:z.enum(['flow','loop','comparison','containment']),
  nodes:z.array(z.object({label:z.string().min(1).max(22),icon:z.enum(['document','agent','check','tool','person','web'])})).length(3),
  links:z.array(z.object({from:z.number().int().min(0).max(2),to:z.number().int().min(0).max(2),label:z.string().min(1).max(18),kind:z.enum(['transfer','observe'])})).min(2).max(3),
});
export type Visual=z.infer<typeof visualSchema>;
export const escapeHtml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const icons:Record<Visual['nodes'][number]['icon'],string>={
  document:'<path d="M-28-36H14L30-20V36H-28Z M14-36V-20H30 M-16-5H18 M-16 8H18 M-16 21H8"/>',
  agent:'<rect x="-35" y="-25" width="70" height="55" rx="16"/><path d="M0-25V-40 M-45-8V14 M45-8V14 M-14 14H14"/><circle cx="-13" cy="-5" r="4"/><circle cx="13" cy="-5" r="4"/>',
  check:'<path d="M0-40L34-26V0Q34 27 0 42Q-34 27-34 0V-26Z M-17 0L-4 13L20-14"/>',
  tool:'<path d="M-22-32L-8-18L8-34Q35-29 30-4L-5 28Q-24 44-36 24Q-39 14-25 2L-8-13"/>',
  person:'<circle cx="0" cy="-18" r="18"/><path d="M-36 35Q-36 7 0 7Q36 7 36 35Z"/>',
  web:'<rect x="-40" y="-32" width="80" height="64" rx="8"/><path d="M-40-12H40 M-27-23H-24 M-15-23H-12 M-10 0L-22 10L-10 20 M10 0L22 10L10 20"/>',
};
export function centersFor(visual:Visual){
  switch(visual.kind){
    case 'comparison': return [[458,140],[230,640],[686,640]];
    case 'loop': return [[458,140],[686,620],[230,620]];
    case 'containment': return [[300,420],[686,170],[686,690]];
    default: return [[230,140],[458,430],[686,720]];
  }
}
export function routesFor(visual:Visual){
  const centers=centersFor(visual);
  return visual.links.map(link=>{
    const [x1,y1]=centers[link.from],[x2,y2]=centers[link.to];
    if(link.from===link.to)throw new Error('Diagram links must join different actors');
    // Attach to the appropriate edge of each card, so layout and moving signal agree.
    const dx=x2-x1,dy=y2-y1;
    let points:number[][];
    if(Math.abs(dy)>Math.abs(dx)){
      const sign=Math.sign(dy),reverse=visual.links.some(other=>other.from===link.to&&other.to===link.from),lane=reverse?(link.from<link.to?-50:50):0,mid=(y1+y2)/2+lane;
      points=[[x1+lane,y1+sign*96],[x1+lane,mid],[x2+lane,mid],[x2+lane,y2-sign*108]];
    }else{
      const sign=Math.sign(dx),mid=(x1+x2)/2;
      points=[[x1+sign*170,y1],[mid,y1],[mid,y2],[x2-sign*182,y2]];
    }
    return {link,points};
  });
}
/** Explicit edges preserve the source relationship; watching never implies routing or blocking. */
export function diagramSvg(visual:Visual,active:number){
  const centers=centersFor(visual);
  const node=(i:number)=>{const [x,y]=centers[i],n=visual.nodes[i];const words=n.label.split(' '),split=words.length>1&&n.label.length>14?Math.ceil(words.length/2):words.length;const lines=[words.slice(0,split).join(' '),words.slice(split).join(' ')].filter(Boolean);return `<g transform="translate(${x} ${y})"><rect x="-170" y="-96" width="340" height="192" rx="${visual.kind==='loop'?70:visual.kind==='flow'?12:28}" fill="${i===active?'#D1EEA2':'#193237'}" stroke="${i===active?'#D1EEA2':'#476267'}" stroke-width="2"/><g transform="translate(0 -36)" fill="none" stroke="${i===active?'#112C2C':'#D1EEA2'}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${icons[n.icon]}</g><text text-anchor="middle" fill="${i===active?'#112C2C':'#F3F1E8'}" font-size="${Math.max(...lines.map(l=>l.length))>17?25:32}" font-weight="600">${lines.map((l,j)=>`<tspan x="0" y="${lines.length===1?63:42+j*35}">${escapeHtml(l)}</tspan>`).join('')}</text></g>`;};
  const links=routesFor(visual).map(({points,link})=>{
    const d=points.map((p,i)=>`${i?'L':'M'}${p[0]} ${p[1]}`).join(' ');
    const [start,end]=[points[0],points[points.length-1]];
    const sameRow=start[1]===end[1];
    const x=sameRow?(start[0]+end[0])/2:(points[1][0]+points[2][0])/2;
    const y=sameRow?start[1]+140:(points[1][1]+points[2][1])/2-18;
    return `<path d="${d}" fill="none" stroke="#809893" stroke-width="4" ${link.kind==='observe'?'stroke-dasharray="8 9"':''} marker-end="url(#arrow)"/><text x="${x}" y="${y}" fill="#A9BDB6" font-size="24" text-anchor="middle">${escapeHtml(link.label)}</text>`;
  }).join('');
  const boundary=visual.kind==='containment'?'<rect x="80" y="240" width="440" height="360" rx="46" fill="none" stroke="#809893" stroke-width="3" stroke-dasharray="12 10"/>':'';
  return `<svg viewBox="0 0 916 880" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0L8 3L0 6" fill="none" stroke="#809893" stroke-width="1.5"/></marker></defs>${boundary}${links}${centers.map((_,i)=>node(i)).join('')}</svg>`;
}
/** Move a signal along actual transfer edges; observation edges remain dashed. */
export function signalPosition(visual:Visual,duration:number){
  const route=routesFor(visual).find(r=>r.link.kind==='transfer')||routesFor(visual)[0];
  // Orthogonal routes may contain repeated corners (e.g. same-row comparisons).
  const points=route.points.filter((p,i)=>i===0||p[0]!==route.points[i-1][0]||p[1]!==route.points[i-1][1]);
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
  const total=lengths.reduce((a,b)=>a+b,0),travel=`mod(t/${Math.max(1,duration/2)},1)*${total}`;
  const coordinate=(axis:number,offset:number)=>{
    let accumulated=0;
    const segments=lengths.map((length,i)=>{const from=points[i][axis],to=points[i+1][axis],start=accumulated;accumulated+=length;return {end:accumulated,value:`${offset+from}+(${travel}-${start})/${length}*(${to-from})`};});
    return segments.reduceRight((rest,s,i)=>i===segments.length-1?s.value:`if(lt(${travel},${s.end}),${s.value},${rest})`,'0');
  };
  return {x:coordinate(0,72),y:coordinate(1,530)};
}

export function captionCues(beats:{narration:string}[],durations:number[]){
  let start=0;
  return beats.flatMap((beat,i)=>{
    const words=beat.narration.trim().split(/\s+/),groups:string[][]=[];
    for(let j=0;j<words.length;j+=7)groups.push(words.slice(j,j+7));
    const cues=groups.map((group,j)=>({start:start+durations[i]*j/groups.length,end:start+durations[i]*(j+1)/groups.length,text:group.join(' ')}));
    start+=durations[i];return cues;
  });
}
export function captionsAss(cues:ReturnType<typeof captionCues>){
  const stamp=(n:number)=>new Date(Math.round(n*100)*10).toISOString().slice(11,22);
  const text=(s:string)=>s.replace(/[{}\\]/g,'').replace(/\r?\n/g,' ');
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,48,&H00F3F1E8,&H00F3F1E8,&H00152B2E,&H00152B2E,0,0,0,0,100,100,0,0,1,1,0,2,95,95,225,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`+cues.map(c=>`Dialogue: 0,${stamp(c.start)},${stamp(c.end)},Default,,0,0,0,,${text(c.text)}`).join('\n');
}
