// One scene per narration scene, sized to the measured narration so picture changes land on the voice.
const PLAN = DATA.scenes.map((s, i, all) => [i === 0 ? 'open' : i === all.length - 1 ? 'skill' : 'say', s.d / (60 / CFG.bpm), s.code]);
