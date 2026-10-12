// Runtime design contract distilled from .agents/skills/motion-graphic/SKILL.md.
// Keep operational agent instructions out of model requests.
export const MOTION_SKILL_REVISION='motion-graphic-v1';
export const MOTION_GRAPHIC_GUIDANCE=`Design an explanation, not a slideshow of narration.
Start with a concrete subject performing a source-supported action. Each beat must have
a clear visual relationship and a distinct explanatory purpose. Keep the same actors
recognizable across beats. Short object labels identify actors; narration supplies nuance.
Prefer specific verbs over slogans, generic advice, or promises. Never invent a number,
causal link, security guarantee, or measured result. Preserve the source's uncertainty.
Choose flow for transfer, loop for actual feedback, comparison for alternatives, or
containment for an isolation boundary. An observer is not a relay or a blocker.
Use concise labels that remain readable at phone size. Every claim must cite supplied
evidence IDs. The opening names the mechanism, the middle explains its operation,
and the final beat gives the supported takeaway and limitation.`;
