// Editorial reel from the Resurface demo film: flat black / signal orange / paper cream / cobalt blue grounds, heavy
// display type, an italic serif aside, mono corner labels. No glow, no scanlines: hard colour cuts with a short band
// wipe, and an iris from the centre into cobalt, as the film cuts into its blue chapter.
const FS = CFG.fonts.serif;
const THEMES = {
  night: { bg: '#0E0D0B', ink: '#F4EFE6', dim: '#8E877C', acc: '#FF5A1F', line: '#2A2723' },
  signal: { bg: '#FF5A1F', ink: '#0E0D0B', dim: '#5A1E07', acc: '#0E0D0B', line: '#E2471A' },
  paper: { bg: '#EFE8DA', ink: '#0E0D0B', dim: '#7A7266', acc: '#FF5A1F', line: '#D9D0BF' },
  cobalt: { bg: '#2B3BFF', ink: '#F4EFE6', dim: '#B8BEFF', acc: '#F4EFE6', line: '#4352FF' },
};
const themeOf = sc => THEMES[(DATA.scenes[sc.i] || {}).theme || 'night'];
function drawBg(t){ const sc = sceneAt(t); ctx.fillStyle = themeOf(sc).bg; ctx.fillRect(0, 0, W, H); }
function overlay(t){}
function hud(t, sc){
  const th = themeOf(sc), m = 48, L = 30;
  ctx.save(); ctx.strokeStyle = rgba(th.ink, .55); ctx.lineWidth = 3;
  const br = (x, y, sx, sy) => { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke(); };
  br(m, m, 1, 1); br(W - m, m, -1, 1); br(m, H - m, 1, -1); br(W - m, H - m, -1, -1); ctx.restore();
  const fr = Math.floor(t * 30) % 30, s = Math.floor(t);
  const o = { f: FM, w: 600, z: 20, c: rgba(th.ink, .8), ls: 3 };
  T(CFG.hudTitle, m + 44, m + 30, o);
  T(`${String(sc.i + 1).padStart(2, '0')} — ${sc.code}`, W - m - 44, m + 30, { ...o, al: 'right' });
  T(`00:${String(s).padStart(2, '0')}:${String(fr).padStart(2, '0')}`, m + 44, H - m - 12, o);
  dot(W - m - 44 - mw(DATA.source.tag, FM, 600, 20, 3) - 24, H - m - 19, 7, th.acc);
  T(DATA.source.tag, W - m - 44, H - m - 12, { ...o, al: 'right' });
}
// first .3 s of a scene: the new ground sweeps up over the last one as a band
function transition(sc, lt){
  if (themeOf(sc) === THEMES.cobalt && themeOf(SC[sc.i - 1]) !== THEMES.cobalt){
    if (lt > .4) return;
    const p = eIO(inv(0, .4, lt)), r = p * Math.hypot(W, H) * .52;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(W / 2, H / 2, r, 0, TAU, true); ctx.clip('evenodd'); lastFrame(SC[sc.i - 1]); ctx.restore();
    ctx.save();
    ctx.strokeStyle = rgba(THEMES.cobalt.ink, .7 * (1 - p)); ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, TAU); ctx.stroke(); ctx.restore();
    return;
  }
  if (lt > .3) return;
  const prev = SC[sc.i - 1], p = eIO(inv(0, .3, lt));
  // Cuts alternate direction so consecutive scenes don't arrive the same way: up, then across.
  if (sc.i % 2 === 0){
    ctx.save(); ctx.beginPath(); ctx.rect(W * p, 0, W * (1 - p), H); ctx.clip(); lastFrame(prev); ctx.restore();
    ctx.fillStyle = themeOf(sc).acc === themeOf(sc).ink ? themeOf(prev).bg : themeOf(sc).acc; ctx.fillRect(W * p, 0, 18, H);
    return;
  }
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H * (1 - p)); ctx.clip(); lastFrame(prev); ctx.restore();
  ctx.fillStyle = themeOf(sc).acc === themeOf(sc).ink ? themeOf(prev).bg : themeOf(sc).acc; ctx.fillRect(0, H * (1 - p) - 18, W, 18);
}

// The previous scene as it ended, so a cut wipes its copy away instead of blanking it a frame early.
function lastFrame(prev){
  const t = prev.t0 + prev.d - 1e-3;
  ctx.fillStyle = themeOf(prev).bg; ctx.fillRect(0, 0, W, H);
  ctx.save(); try { S[prev.id].draw(prev.d - 1e-3, prev.d, t); } catch (e){ console.error(e); } ctx.restore();
}
