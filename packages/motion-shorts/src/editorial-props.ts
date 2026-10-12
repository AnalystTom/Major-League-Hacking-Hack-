import type {EditorialPlan} from './editorial-plan';
type Element=EditorialPlan['shots'][number]['elements'][number];
export const illustratedKinds=new Set(['chamber','observer','packet','network']);
/** Original vector props. Activity is illustrative, never a measured trace or product screenshot. */
export function illustratedProp(e:Element){
 const stroke='stroke="currentColor" stroke-width="5" stroke-linejoin="round" fill="none"';
 let drawing='';
 if(e.kind==='chamber')drawing=`
 <path d="M80 120 300 25 520 120 520 370 300 470 80 370Z" fill="${e.fill}" stroke="currentColor" stroke-width="5"/>
 <path d="M80 120 300 220 520 120M300 220V470" ${stroke} opacity=".45"/>
 <path d="M80 370 300 270 520 370M300 25V270" ${stroke} stroke-dasharray="10 12" opacity=".22"/>
 <path d="M125 345 300 420 475 345 300 268Z" fill="currentColor" opacity=".12"/>
 <g data-lift><path d="M200 225 300 182 400 225 400 288 300 330 200 288Z" fill="${e.ink}"/>
 <path d="M200 225 300 269 400 225M300 269V330" stroke="${e.fill}" stroke-width="4" fill="none"/>
 <path d="M242 227 297 250 357 227" stroke="${e.fill}" stroke-width="7" fill="none"/></g>
 <path data-flow d="M112 145 270 217 270 406M330 406 487 335 487 169" ${stroke} stroke-dasharray="24 180"/>
 <circle cx="80" cy="120" r="10" fill="currentColor"/><circle cx="520" cy="370" r="10" fill="currentColor"/>`;
 if(e.kind==='observer')drawing=`
 <path d="M80 130 300 35 520 130 520 375 300 465 80 375Z" fill="${e.fill}" stroke="currentColor" stroke-width="5"/>
 <path d="M120 200Q300 60 480 200Q300 340 120 200Z" ${stroke}/>
 <circle cx="300" cy="200" r="80" ${stroke} opacity=".3"/>
 <g data-watch><circle cx="300" cy="200" r="47" fill="currentColor"/><circle cx="313" cy="183" r="12" fill="${e.fill}"/></g>
 <path d="M140 340H460M140 370H390M140 400H310" ${stroke} opacity=".24"/>
 <path data-flow d="M140 340H460M140 370H390M140 400H310" ${stroke} stroke-dasharray="30 220"/>`;
 if(e.kind==='packet')drawing=`
 <path d="M80 160 300 60 520 160 520 340 300 440 80 340Z" fill="${e.fill}" stroke="currentColor" stroke-width="8"/>
 <path d="M80 160 300 260 520 160M300 260V440" ${stroke} opacity=".5"/>
 <path d="m230 166-52 24 52 24m140-48 52 24-52 24m-47-52-40 76" ${stroke}/>`;
 if(e.kind==='network')drawing=`
 <ellipse cx="300" cy="125" rx="215" ry="80" fill="${e.fill}" stroke="currentColor" stroke-width="5"/>
 <path d="M85 125V350C85 455 515 455 515 350V125M85 240C85 345 515 345 515 240" fill="${e.fill}" stroke="currentColor" stroke-width="5"/>
 <ellipse cx="300" cy="125" rx="215" ry="80" ${stroke}/>
 <path d="M135 230v35m35-23v35m35-23v35M135 345v35m35-23v35m35-23v35" ${stroke}/>
 <path data-flow d="M245 270h210M245 385h210" ${stroke} stroke-dasharray="45 120"/>
 <path d="M160 105 290 155 440 105" ${stroke} opacity=".4"/>`;
 return `<svg viewBox="0 0 600 500" aria-hidden="true">${drawing}</svg>`;
}
export function propActivity(time:number){
 return {lift:-12*(1-Math.cos(time*1.8)),look:28*Math.sin(time*.9),flow:-time*65,scan:time%3/3};
}
