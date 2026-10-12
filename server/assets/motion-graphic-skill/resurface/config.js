// Resurface short: one source -> narrated lessons -> the skill it became. DATA is written per short by motion-skill.ts.
const DATA = /*DATA*/null;
const CFG = {
  bpm: 120,
  colors: { bg: '#0E0D0B', panel: '#1A1815', line: '#2A2723', ink: '#F4EFE6', dim: '#8E877C', grid: '#22201C',
            acc: '#FF5A1F', accHi: '#FF8A5C', alt: '#F4EFE6', bad: '#FF5A1F' },
  fonts: { sans: '"Funnel Sans",system-ui,sans-serif', display: '"Funnel Display","Funnel Sans",system-ui,sans-serif',
           mono: '"Martian Mono",ui-monospace,Menlo,monospace', serif: '"Instrument Serif",Georgia,serif' },
  textSplit: false,
  hudTitle: 'RESURFACE',
  hudMeta: t => '',
  cta: { href: '', newTab: true },
  endCta: null,
  endCtaBeat: 6,
  posterT: 1.6,
  watchKey: 'resurface-demo-' + (DATA && DATA.id),
  music: { groove: 'soft', liteScenes: ['say'], arpScenes: ['skill'], tailBeats: 4 },
};
