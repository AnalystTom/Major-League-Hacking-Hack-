import {z} from 'zod';
import {validateEvidence,type Technique} from './contracts';

export const EDITORIAL_REVISION='resurface-editorial-v10';
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const editorialElement=z.object({
  id:z.string().min(1).max(32),
  kind:z.enum(['text','panel','circle','line','document','browser','terminal','waveform','chamber','observer','packet','network']),
  x:z.number().min(48).max(1032),y:z.number().min(170).max(1480),
  width:z.number().min(8).max(984),height:z.number().min(8).max(1280),
  text:z.string().max(140),fontSize:z.number().min(28).max(150),
  font:z.enum(['sans','serif','mono']),fill:color,ink:color,
  motion:z.enum(['hold','arrive','travel','draw']),
  delay:z.number().min(0).max(.7),span:z.number().min(.08).max(.8),
  dx:z.number().min(-800).max(800),dy:z.number().min(-1200).max(1200),
});
export const editorialPlanSchema=z.object({
  title:z.string().min(1).max(80),
  art_direction:z.string().min(20).max(700),
  content_points:z.array(z.object({id:z.string().min(1),point:z.string().min(1),evidence_ids:z.array(z.string()).min(1)})).min(2).max(16),
  shots:z.array(z.object({
    id:z.string().min(1),purpose:z.string().min(1).max(200),
    composition:z.enum(['editorial','closeup','demonstration','comparison','sequence','conclusion']),
    narration:z.string().min(1).max(600),
    point_ids:z.array(z.string()).min(1),evidence_ids:z.array(z.string()).min(1),
    background:color,accent:color,ink:color,
    elements:z.array(editorialElement).min(2).max(10),
  })).min(4).max(6),
});
export type EditorialPlan=z.infer<typeof editorialPlanSchema>;
export const coverageSchema=z.object({missing_points:z.array(z.string()),unsupported_claims:z.array(z.string()),visual_misrepresentations:z.array(z.string())});

export function visualBrief(input:Technique){
  const topic=`${input.name} ${input.category} ${input.processed_text}`.toLowerCase();
  if(/sandbox|sentinel|isolation|security|containment/.test(topic))return 'Lively illustrated technical explainer. The central props MUST be chamber (isometric sandbox workspace), observer (tracking lens representing the sentinel), packet (moving information) and network (external service). Use these detailed animated vector props instead of labeled panels. Open on a packet already moving; create curiosity about who watches the outbound communication. A lens represents the observation role, not guaranteed detection. No external deployment location is established. Technical cutaway film. Use carbon, white and electric blue; bold sans and precise mono labels, not editorial serif or paper documents. Show nested physical spaces, moving outbound payloads and observation as a role, not a claimed deployment location. Alternate an extreme close-up of the boundary with an exterior view and an oversight view. No robot icons, shield icons, three-node graphs, or paper/document metaphors. Design an actual spatial demonstration; do not repeat an opening/title-paper/conclusion sequence.';
  if(/voice|dubbing|speech|audio/.test(topic))return 'Audio production film. Use waveforms, recording regions, tracks and a changing playhead as illustrations, never fabricated measurements. Focus on an audible/textual input becoming an output; show local processing spatially. Cool mint, charcoal and white with bold sans typography. No paper documents or actor-node diagrams.';
  if(/interview|assumption|question/.test(topic))return 'Editorial interview film. Warm paper, charcoal and vermilion; serif display typography. Carry the idea as a physical paper while questions and answers enter different sides of the scene. Use rhythm and changing scale to convey repeated questioning. Show the outcome-evidence limitation without inventing successful results.';
  if(/presentation|document|slides|launch assets/.test(topic))return 'Production-workbench film. Use document surfaces, a layout canvas and output artifacts at very different scales. Ivory, deep plum and yellow accents. Show a supported transformation step by step; distinguish illustration from real product UI. Avoid a generic title followed by three connected boxes.';
  if(/parallel|orchestrat|sessions|coding-agent/.test(topic))return 'Coordination film. Use independent workspaces, task lanes and purposeful movement between them, not three actor cards with arrows. White, cobalt and dark ink; bold sans type. Explain the actual dependency or review action through spatial choreography. Do not invent metrics or imply guaranteed speedups.';
  return 'Choose a concrete visual world from the source-specific objects and actions. Avoid defaulting to paper, robots or three-node diagrams. Select a distinct palette, typographic voice and narrative structure suitable to this artifact. Compose scenes at different scales; use a demonstrable action rather than repeated title cards.';
}

export function validateEditorialPlan(input:Technique,value:unknown){
  const plan=editorialPlanSchema.parse(value),ids=new Set(plan.content_points.map(p=>p.id)),covered=new Set<string>();
  if(ids.size!==plan.content_points.length)throw Error('Duplicate content point IDs');
  for(const point of plan.content_points)validateEvidence(input,point.evidence_ids,true);
  for(const shot of plan.shots){
    validateEvidence(input,shot.evidence_ids,true);
    for(const id of shot.point_ids){if(!ids.has(id))throw Error('Unknown content point');covered.add(id);}
    if(new Set(shot.elements.map(e=>e.id)).size!==shot.elements.length)throw Error('Duplicate element IDs');
    for(const e of shot.elements){
      if(e.x+e.width>1032||e.y+e.height>1510)throw Error(`Element ${e.id} exceeds picture safe area`);
      if(e.motion==='travel'&&(e.x+e.dx<48||e.x+e.dx+e.width>1032||e.y+e.dy<170||e.y+e.dy+e.height>1510))throw Error(`Element ${e.id} travels outside picture safe area`);
      if(e.delay+e.span>1.001&&e.motion!=='hold')throw Error(`Element ${e.id} motion cannot finish before the cut`);
      if(e.kind==='text'&&e.text.trim().split(/\s+/).length>18)throw Error('On-screen text must be concise; retain detail in narration');
    }
  }
  if(covered.size!==ids.size)throw Error('Narrative omits declared content points');
  if(new Set(plan.shots.map(s=>s.composition)).size<3)throw Error('Use at least three distinct shot compositions');
  if(plan.shots.reduce((n,s)=>n+s.narration.split(/\s+/).length,0)>200)throw Error('Split this dense artifact into multiple shorts instead of truncating it');
  const joins=plan.shots.slice(1).filter((shot,i)=>shot.elements.some(e=>plan.shots[i].elements.some(previous=>continuingObject(previous,e))));
  if(joins.length<2)throw Error('Carry the same visual object across at least two adjacent shot boundaries');
  if(plan.shots.filter(shot=>shot.elements.some(e=>e.kind!=='text'&&e.motion==='travel'&&(Math.abs(e.dx)+Math.abs(e.dy)>80))).length<2)throw Error('At least two shots must demonstrate a meaningful object action');
  return plan;
}

export const EDITORIAL_DIRECTION=`Direct an original animated editorial film for this artifact, not a branded diagram template.
Read ALL processed_text and evidence. First list every material content point, including qualifications and unknowns; then cover every point in narration. Never discard a fact merely to meet an arbitrary duration. Use approximately the word count of processed_text; up to 200 if needed. Do not pad a short source to fill shots. Four to six shots, which may be brief. Lead with a source-supported tension or an intriguing question in the first sentence, not "The discussion describes" or a definition. Use spoken, concrete language, never a fake result or alarmist hook. Each shot speaks a complete natural thought, flowing into the next. No invented claims or examples presented as facts. Write like a clear documentary narrator, not an analyst report: concrete subject, active verb, natural rhythm. Avoid repeated "the description establishes", "the evidence describes", "the important distinction is" and explaining the same point twice. State uncertainty once in plain language while keeping each distinct limitation.
Choose an art direction specific to the topic. Explain it in art_direction. Design each shot's composition yourself through the element coordinates: there is NO fixed header/headline/three-box layout. Avoid robot/shield icons and node-link diagrams. Do not make every shot a title over three panels.
Start with the mechanism already in action, not a title card. Use filmmaking grammar: follow a concrete object through a close-up, a visible action or transformation, a contrast or escalation, then a precise ending. Do not impose the same five-part outline on unrelated topics. At least three distinct composition categories. Change shot scale and object arrangement, while carrying a recognizable object or color into the next shot. Let something purposeful happen every few seconds. Motion must perform the explanation, not decorate a static card. Combine typographic scale with oversized source-relevant objects: documents, browser/terminal abstractions, audio waves, comparisons or sequences. These are explanatory illustrations, not fabricated screenshots or measured charts.
Visual language: confident flat color, restrained palette, generous negative space, warm paper/ink or topic-appropriate saturated backgrounds, editorial serif/sans contrast, no gradients/glows. Use dark and light shots with intentional cuts. A single word can be huge; a full narration paragraph cannot. Put the specific tool/subject name in the opening composition. Preserve all detail in narration, not on-screen paragraphs. Source attribution and captions are supplied separately by the renderer.
1080x1920 canvas. The picture area is x48..1032, y170..1510. Coordinates are TOP LEFT. Width+ x <=1032; height+y <=1510. Text wraps within its rectangle; allow generous height (fontSize * 1.25 per line). Typography: display 80-150px, labels 34-48px. Use 2-10 elements per shot, favor 4-7. Elements draw in array order, background panels first.
Kinds: chamber (animated isometric workspace with moving internal activity, for containment/computing), observer (animated tracking lens, ONLY for observation/monitoring), packet (isometric information parcel, use travel to carry it between locations), network (animated external service/server illustration). These illustrations contain no actual metrics or UI and do not imply successful protection. Use large props: at least 260px wide and 240px high, ideally 500-850px for the focal object. Labels are placed BELOW the illustration within its element height: reserve at least 80px for labels. On relevant topics, these are the primary visuals, not panel cards. Other kinds: text (free typography), panel (flat rounded rectangle), circle, line (horizontal rule), document (paper illustration, text is its short title), browser (schematic window, short title), terminal (schematic terminal with literal command only if sourced), waveform (illustrative audio, not measured data). Non-text objects should be large enough to recognize on a phone.
Continuity is required: across at least two adjacent shot boundaries, reuse a non-text/non-line object with EXACTLY the same id, kind, text, fill and ink. Its position and size may change: the renderer will carry it from its previous end position into the new composition over 0.6 seconds. Reuse IDs only for the same actor/object, not unrelated scenery. Keep the same background through connected actions; reserve palette cuts for actual narrative turns. At least two shots must use travel on a non-text object with more than 80 pixels displacement to demonstrate a source-supported action. Supporting objects should be visible from the first frame (hold, delay=0); avoid empty stages and slow label build-ups. Write purpose as the visible action, not the topic. State the continuity and progression in art_direction. Avoid headings on every shot; use them only when they add information beyond the caption. Never spend a shot only displaying a list.
Every element supplies id,kind,x,y,width,height,text,fontSize,font,fill,ink,motion,delay,span,dx,dy. Fonts serif/sans/mono. Colors #RRGGBB. Empty text for purely visual shapes. Hold keeps position; arrive starts at x+dx,y+dy and settles at x,y; travel moves from x,y to x+dx,y+dy; draw reveals width. delay and span are fractions of actual shot duration. Keep travel endpoints inside picture bounds. Movement should show an action such as entering a workspace, separating options, revising a document or passing a result. The chamber, observer, network, browser, document and waveform props have continuous internal illustrative activity even when held. Keep the action focal and purposeful, not a screen full of competing moving decorations. Packet travel should span .65-.8 of the shot, with delay=0, to keep visible movement through narration. Static supporting elements use hold, dx=dy=0. Do not use travel for headings or make all objects arrive together.
All point_ids and evidence_ids must refer to supplied/declared IDs. Unknown monitoring effectiveness or missing outcome evidence must remain explicit in narration. A diagram/animation must not imply blocking, accuracy, improvement or a measurement not established by the input.`;

// A continuing identity is a visual object, never merely a recurring heading.
export function continuingObject(a:EditorialPlan['shots'][number]['elements'][number],b:EditorialPlan['shots'][number]['elements'][number]){
  return a.id===b.id&&a.kind===b.kind&&a.kind!=='text'&&a.kind!=='line'&&a.text===b.text&&a.fill===b.fill&&a.ink===b.ink;
}
