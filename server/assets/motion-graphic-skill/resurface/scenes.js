// Scenes read DATA (written per short by server/src/outputs/render/motion-skill.ts): the source, one entry per narration scene, and the skill it became.
// Each narrated scene lands its headline with one of the reel's moves (the script picks it; REFERENCE.md describes them).
const dataOf = t => DATA.scenes[sceneAt(t).i];
const HX = 90, HY = 470, HW = W - 2 * HX;

// a mono kicker that types on and shrinks to fit the safe width (long categories)
function label(s, x, y, lt, t0, c, al = 'left'){ T(typeOn(s, inv(t0, t0 + .32, lt)), x, y, { f: FM, w: 700, z: 22, c, ls: 4, al, fit: W - 2 * 90 }); }

// when a headline's words land: one step per word, so moves and sound can be timed without drawing
const headTiming = (text, t0, span = 1.4) => { const n = Math.max(1, text.split(/\s+/).filter(Boolean).length), step = Math.min(.16, span / n); return { step, tEnd: t0 + n * step }; };

// headline: words land one after another (heavy display), then an underline springs out under the last line.
// mode 'land' springs each word up; 'slam' hits it in from the right with a skew and motion blur, as in the reel.
function headline(text, x, y, lt, t0, th, width = W - 2 * x, z = 132, span = 1.4, o = {}){
  const { mode = 'land', ul = true } = o;
  const { lines, z: size } = wrapLines(text, FD, 800, z, width, 3), lh = size * 1.02;
  const words = lines.flatMap((l, li) => l.split(' ').map((w, wi, arr) => ({ w, li, pre: arr.slice(0, wi).join(' ') + (wi ? ' ' : '') })));
  const { step, tEnd } = headTiming(text, t0, span);
  words.forEach((wd, k) => { const t1 = t0 + k * step; if (lt < t1) return;
    const wx = x + mw(wd.pre, FD, 800, size), wy = y + wd.li * lh;
    if (mode === 'slam'){
      const p = spring(lt - t1, ...SPRING.snappy), q = clamp(1 - p);
      ctx.save(); if (q > .03) ctx.filter = `blur(${(q * 18).toFixed(1)}px)`;
      ctx.translate(wx + q * size * .7, wy); ctx.transform(1, 0, -.22 * q, 1, 0, 0);
      T(wd.w, 0, 0, { f: FD, w: 800, z: size, c: th.ink, a: clamp(p * 1.8) }); ctx.restore();
    } else {
      const p = spring(lt - t1, ...SPRING.heavy);
      T(wd.w, wx, wy + (1 - p) * 46, { f: FD, w: 800, z: size, c: th.ink, a: clamp(p * 1.6) });
    }
  });
  const lastLine = lines[lines.length - 1], ly = y + (lines.length - 1) * lh, ul0 = spring(lt - tEnd, ...SPRING.snappy);
  if (ul && ul0 > 0){ ctx.fillStyle = th.acc; ctx.fillRect(x, ly + size * .28, mw(lastLine, FD, 800, size) * Math.min(1, ul0), 14); }
  const lw = lastLine.split(' ').pop(), lx = x + mw(lastLine.slice(0, lastLine.length - lw.length), FD, 800, size);
  return { bottom: ly + size * .28 + 14, tEnd, size, last: { x: lx, y: ly, w: mw(lw, FD, 800, size) } };
}

// the italic serif aside under a headline, wrapped to at most 3 lines; returns where it ends
function aside(text, x, y, lt, t0, th, size = 56, maxLines = 3){
  const { lines, z } = wrapLines(text, FS, 'italic 400', size, W - 2 * x, maxLines);
  lines.forEach((l, i) => rise(l, x, y + i * z * 1.12, lt, t0 + i * .08, { f: FS, w: 'italic 400', z, c: th.ink }));
  return y + (lines.length - 1) * z * 1.12 + z * .3;
}

// a line that rises out of its own mask, like the reel's "never."
function maskRise(s, x, y, lt, t0, o, dur = .6){
  const p = inv(t0, t0 + dur, lt); if (p <= 0) return;
  const z = o.z, e = 1 - Math.pow(1 - p, 4);
  ctx.save(); ctx.beginPath(); ctx.rect(0, y - z * 1.05, W, z * 1.4); ctx.clip();
  T(s, x, y + (1 - e) * z * 1.15, { ...o, fit: o.fit ?? HW }); ctx.restore();
}

// the outline badge that slams in at a slight angle
function stampBadge(text, cx, cy, lt, t1, th, z = 50){
  const sp = inv(t1, t1 + .18, lt); if (sp <= 0) return;
  const sc = lerp(1.6, 1, eBack(sp)), bw = mw(text, FD, 800, z) + 64;
  ctx.save(); ctx.translate(cx - bw / 2, cy); ctx.rotate(-.12); ctx.scale(sc, sc); ctx.globalAlpha = clamp(sp * 2);
  ctx.strokeStyle = th.acc; ctx.lineWidth = 7; ctx.beginPath(); ctx.roundRect(-bw / 2, -z, bw, z * 2, 18); ctx.stroke();
  T(text, 0, z * .36, { f: FD, w: 800, z, c: th.acc, al: 'center' }); ctx.restore();
}

// a short camera shake right after an impact at t1
function shake(lt, t1){
  const k = inv(t1, t1 + .3, lt); if (k <= 0 || k >= 1) return;
  const a = 14 * (1 - k); ctx.translate(Math.sin(lt * 90) * a, Math.cos(lt * 77) * a * .7);
}

// one letter at a time, each with its own vertical offset (null = not drawn yet)
function letters(s, x, y, z, dy, c){
  let px = x;
  for (let i = 0; i < s.length; i++){ const ch = s[i], o = dy(i); if (o !== null && ch !== ' ') T(ch, px, y + o, { f: FD, w: 800, z, c }); px += mw(ch, FD, 800, z); }
}

// the number in a count headline: as written in the script ("1,165", "4.5"), plus a sign or unit stuck to it
const NUM = /([$€£]?)(\d[\d,]*(?:\.\d+)?)([%×x+]?)/;
function countText(n, p){
  const target = parseFloat(n.replace(/,/g, '')), dec = (n.split('.')[1] || '').length, v = target * (1 - Math.pow(1 - clamp(p), 3));
  const s = v.toFixed(dec);
  return n.includes(',') ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
}

// The moves. Each draws the scene's headline from t0 and returns { bottom, tEnd } for the aside.
const MOVE = {
  slam: (s, th, lt, t0) => headline(s.text, HX, HY, lt, t0, th, HW, 132, 1.4, { mode: 'slam' }),
  // the headline's last word is struck through and the swap rises under it in the italic serif
  strike: (s, th, lt, t0) => {
    const h = headline(s.text, HX, HY, lt, t0, th, HW, 132, 1.2, { mode: 'slam', ul: false }), t1 = h.tEnd + .3;
    const sp = 1 - Math.pow(1 - inv(t1, t1 + .25, lt), 3);
    if (sp > 0){ ctx.fillStyle = th.acc; ctx.fillRect(h.last.x - 8, h.last.y - h.size * .36, (h.last.w + 16) * sp, Math.max(10, h.size * .1)); }
    const z = Math.min(200, h.size * 1.3), y = h.bottom + z * .78;
    maskRise(s.swap, HX, y, lt, t1 + .35, { f: FS, w: 'italic 400', z, c: th.acc });
    return { bottom: y + z * .2, tEnd: t1 + .6 };
  },
  // the headline rolls letter by letter into the swap
  roll: (s, th, lt, t0, d) => {
    const a = s.text, b = s.swap, y = 700; let z = 230;
    while ((mw(a, FD, 800, z) > HW || mw(b, FD, 800, z) > HW) && z > 90) z *= .94;
    const tOut = Math.max(t0 + .9, Math.min(d * .35, t0 + 1.5)), tIn = tOut + .12;
    ctx.save(); ctx.beginPath(); ctx.rect(0, y - z * 1.0, W, z * 1.3); ctx.clip();
    letters(a, HX, y, z, i => { const t1 = t0 + i * .045; if (lt < t1) return null;
      return (1 - spring(lt - t1, ...SPRING.snappy)) * z * 1.1 - eIO(inv(tOut + i * .04, tOut + i * .04 + .35, lt)) * z * 1.2; }, th.ink);
    letters(b, HX, y, z, i => { const t1 = tIn + i * .045; return lt < t1 ? null : (1 - spring(lt - t1, ...SPRING.snappy)) * z * 1.15; }, th.ink);
    ctx.restore();
    const tEnd = tIn + b.length * .045, ul = spring(lt - tEnd - .1, ...SPRING.snappy);
    if (ul > 0){ ctx.fillStyle = th.acc; ctx.fillRect(HX, y + z * .26, mw(b, FD, 800, z) * Math.min(1, ul), 14); }
    return { bottom: y + z * .26 + 14, tEnd: tEnd + .2 };
  },
  // the slam headline, then the swap stamped under it (placed by lesson(), after the aside)
  stamp: (s, th, lt, t0) => headline(s.text, HX, HY, lt, t0, th, HW, 132, 1.4, { mode: 'slam' }),
  // the first number counts up huge, the rest of the headline slams in under it
  count: (s, th, lt, t0) => {
    // a signed number can't count up from zero, so it slams like any headline (validateScript already avoids this)
    const m = s.text.match(NUM); if (!m || /([-−–+]\s*[$€£]?|[$€£]\s+)\s*$/.test(s.text.slice(0, m.index))) return MOVE.slam(s, th, lt, t0);
    // With an illustration below, the number is drawn smaller and higher so both fit above content_bottom.
    const rest = s.text.replace(m[0], ' ').replace(/\s+/g, ' ').trim(), y = s.visual ? 600 : 650;
    const shown = `${m[1]}${countText(m[2], inv(t0 + .05, t0 + 1.15, lt))}${m[3]}`, full = `${m[1]}${m[2]}${m[3]}`;
    let z = s.visual ? 230 : 330; while (mw(full, FD, 800, z) > HW && z > 120) z *= .94;
    rise(shown, HX, y, lt, t0, { f: FD, w: 800, z, c: th.ink }, .35, 60);
    if (!rest) return { bottom: y + z * .2, tEnd: t0 + 1.2 };
    return headline(rest, HX, y + (s.visual ? 130 : 170), lt, t0 + .9, th, HW, s.visual ? 84 : 112, 1, { mode: 'slam' });
  },
};

// when each move's big moments land, for the sound and the stamp's shake
function moveTimes(s, t0, d){
  const { tEnd } = headTiming(s.text, t0, s.move === 'strike' ? 1.2 : 1.4);
  if (s.move === 'strike') return { hit: tEnd + .3, after: tEnd + .65 };
  if (s.move === 'roll'){ const tOut = Math.max(t0 + .9, Math.min(d * .35, t0 + 1.5)); return { hit: tOut, after: tOut + .12 }; }
  if (s.move === 'stamp') return { hit: tEnd + .45 + .18 };
  if (s.move === 'count') return { hit: t0 + .05, after: t0 + 1.15 };
  return { hit: t0 };
}

// a narrated scene's headline with its move, the aside, and (for stamp) the badge
function lesson(s, th, lt, t0, d){
  const mv = MOVE[s.move] ? s.move : 'slam', at = moveTimes({ ...s, move: mv }, t0, d);
  if (mv === 'stamp') shake(lt, at.hit);
  const h = MOVE[mv](s, th, lt, t0, d);
  const end = s.sub ? aside(s.sub, HX, h.bottom + 90, lt, Math.max(h.tEnd + .25, Math.min(2.2, d * .35)), th) : h.bottom;
  if (mv === 'stamp' && s.swap) stampBadge(s.swap.toUpperCase(), W - HX - 10, Math.min(1190, end + 170), lt, at.hit - .18, th);
  // The scene's illustration is its second beat: it lands after the headline and keeps changing until the cut.
  if (s.visual) return drawVisual(s.visual, th, lt, Math.max(h.tEnd + .35, .9), d, end + (mv === 'stamp' && s.swap ? 250 : 80));
  // A paced progress reveal keeps longer spoken scenes alive after headline and aside land.
  if (d > 4 && lt > 2.4){ ctx.fillStyle = th.acc; ctx.fillRect(HX, DATA.layout.content_bottom - 30, HW * inv(2.4, d - .2, lt), 8); }
}
const moveCues = (s, t0, d) => {
  const mv = s && s.move, at = s ? moveTimes(s, t0, d) : { hit: t0 };
  if (mv === 'strike') return [[at.hit, 'whoosh', .18, .12], [at.after, 'hit', .5]];
  if (mv === 'roll') return [[at.hit, 'roll', .5, 10], [at.after, 'whoosh', .2, .1]];
  if (mv === 'stamp') return [[at.hit, 'stamp', .7]];
  if (mv === 'count') return [[at.hit, 'roll', 1.1, 16], [at.after, 'hit', .5]];
  return [[t0, 'slam', .35]];
};

// the platform tile from the demo film: a cream rounded square with the source's mark
function tile(cx, cy, s, kind, a){
  ctx.save(); ctx.globalAlpha *= a;
  ctx.fillStyle = '#F4EFE6'; ctx.beginPath(); ctx.roundRect(cx - s / 2, cy - s / 2, s, s, s * .22); ctx.fill();
  if (kind === 'x'){ T('𝕏', cx, cy + s * .2, { f: FK, w: 700, z: s * .58, c: '#0E0D0B', al: 'center' }); }
  else if (kind !== 'youtube'){ T((DATA.source.platform[0] || '•').toUpperCase(), cx, cy + s * .2, { f: FD, w: 800, z: s * .58, c: '#FF5A1F', al: 'center' }); }
  else { const w = s * .56, h = s * .4; ctx.fillStyle = '#E62117'; ctx.beginPath(); ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h * .28); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(cx - w * .13, cy - h * .25); ctx.lineTo(cx + w * .2, cy); ctx.lineTo(cx - w * .13, cy + h * .25); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

S.open = {
  draw(lt, d, t){
    const th = THEMES.night, src = DATA.source;
    // Source context supports the hook instead of delaying it behind a title-card preamble.
    tile(130, 240, 80, src.kind, inv(0, .25, lt));
    label(src.platform.toUpperCase(), 210, 215, lt, .05, th.dim);
    const { lines, z } = wrapLines(src.title, FK, 700, 28, W - 300, 2);
    lines.forEach((l, i) => rise(l, 210, 260 + i * z * 1.15, lt, .1, { f: FK, w: 700, z, c: th.dim }));
    label(DATA.category.toUpperCase(), 90, 330, lt, .05, th.acc);
    lesson(dataOf(t), th, lt, .12, d);
  },
  // The engine's groove starts with scene 2; a quiet chord sustains the opening beneath its narration.
  cues: d => [[0, 'pad', [220, 261.63, 329.63], d, .1], [0, 'whoosh', .3, .12], [.05, 'blip', 880, .05], ...moveCues(DATA.scenes[0], .12, d)]
};

S.say = {
  draw(lt, d, t){
    const sc = sceneAt(t), th = themeOf(sc), s = dataOf(t);
    // Decorative step number also stays above the reserved caption band.
    if (!s.visual) T(String(sc.i).padStart(2, '0'), W - 90, 1300, { f: FD, w: 800, z: 320, c: rgba(th.ink, .07), al: 'right', a: inv(.1, .5, lt) });
    label(`LESSON ${String(sc.i).padStart(2, '0')}${s.label ? ` · ${s.label.toUpperCase()}` : ''}`, 90, 330, lt, .15, th.acc === th.ink ? th.ink : th.acc);
    lesson(s, th, lt, .25, d);
  },
  cues: (d, sc) => [[.25, 'whoosh', .22, .08], ...moveCues(DATA.scenes[sc.i], .25, d)]
};

S.skill = {
  draw(lt, d, t){
    const th = THEMES.paper, sk = DATA.skill, s = dataOf(t);
    if (!sk){ lesson(s, th, lt, .35, d); return; }
    // The skill's actual name, hyphens and all, then its description in full and what to do first.
    label('THE SKILL', 90, 330, lt, .1, th.acc);
    rise(sk.name, 90, 440, lt, .35, { f: FM, w: 600, z: 64, c: th.ink, fit: W - 180 }, .45, 30);
    const ul = spring(lt - .7, ...SPRING.snappy);
    if (ul > 0){ ctx.fillStyle = th.acc; ctx.fillRect(90, 470, Math.min(W - 180, mw(sk.name, FM, 600, 64)) * Math.min(1, ul), 10); }
    const end = aside(sk.description, 90, 570, lt, .8, th, 46, 4);
    if (s.visual) drawVisual(s.visual, th, lt, 1.4, d, end + 70);
  },
  cues: d => [[.35, 'slam', .35]]
};

// ---- Illustrations: the second beat of a scene, drawn in the free space between the copy and content_bottom ----
const VB = () => DATA.layout.content_bottom - 50;
const inkOf = th => th.acc === th.ink ? th.ink : th.acc;
const pop = (lt, t1) => spring(lt - t1, ...SPRING.snappy);
function drawVisual(v, th, lt, t0, d, top){
  const bottom = VB(), room = bottom - top;
  if (room < 170 || lt < t0) return;
  const f = VIS[v.kind]; if (f) f(v, th, lt, t0, Math.max(t0 + 1, d - .3), top, bottom);
}
// times n beats from t0 to tEnd, at least .45 s apart, so the picture keeps changing through the scene
const beats = (n, t0, tEnd) => Array.from({ length: n }, (_, i) => t0 + i * Math.max(.45, (tEnd - t0 - .8) / Math.max(1, n)));
const VIS = {
  // two bars, before and after, each with its source-stated value counting up
  compare(v, th, lt, t0, tEnd, top, bottom){
    const rows = [v.before, v.after], nums = rows.map(r => parseFloat(String(r.value).replace(/[^\d.]/g, '')) || 0), max = Math.max(...nums, 1);
    const rowH = Math.min(190, (bottom - top) / 2), at = beats(2, t0, tEnd);
    rows.forEach((r, i) => {
      const p = pop(lt, at[i]); if (p <= 0) return;
      const y = top + i * rowH, bw = (HW - 230) * nums[i] / max * Math.min(1, p);
      label(String(r.label).toUpperCase(), HX, y + 30, lt, at[i], i ? inkOf(th) : th.dim);
      ctx.fillStyle = i ? inkOf(th) : rgba(th.ink, .28); ctx.beginPath(); ctx.roundRect(HX, y + 55, Math.max(8, bw), 70, 10); ctx.fill();
      const m = String(r.value).match(NUM), shown = m ? String(r.value).replace(m[0], `${m[1]}${countText(m[2], inv(at[i], at[i] + .8, lt))}${m[3]}`) : String(r.value);
      T(shown, HX + Math.max(8, bw) + 24, y + 112, { f: FD, w: 800, z: 66, c: th.ink });
    });
  },
  // numbered steps that light up one after another: what to do
  steps(v, th, lt, t0, tEnd, top, bottom){
    const items = v.items.slice(0, 4), gap = Math.min(150, (bottom - top) / items.length), at = beats(items.length, t0, tEnd), c = inkOf(th);
    items.forEach((s, i) => {
      const p = pop(lt, at[i]); if (p <= 0) return;
      const y = top + i * gap, lit = lt >= at[i] + .05;
      ctx.save(); ctx.globalAlpha *= clamp(p * 1.6); ctx.translate((1 - p) * -40, 0);
      ctx.fillStyle = lit ? c : 'transparent'; ctx.strokeStyle = c; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(HX + 38, y + 38, 36, 0, TAU); lit ? ctx.fill() : ctx.stroke();
      T(String(i + 1), HX + 38, y + 54, { f: FD, w: 800, z: 44, c: lit ? th.bg : c, al: 'center' });
      T(s, HX + 104, y + 56, { f: FD, w: 700, z: 54, c: th.ink, fit: HW - 110 });
      if (i < items.length - 1 && lt > at[i + 1] - .3){ ctx.fillStyle = rgba(th.ink, .35); ctx.fillRect(HX + 35, y + 80, 6, (gap - 84) * inv(at[i + 1] - .3, at[i + 1], lt)); }
      ctx.restore();
    });
  },
  // a terminal card that types the command from the sources
  command(v, th, lt, t0, tEnd, top){
    const p = pop(lt, t0); if (p <= 0) return;
    const h = 210, y = top + (1 - p) * 40;
    ctx.save(); ctx.globalAlpha *= clamp(p * 1.6);
    ctx.fillStyle = '#0E0D0B'; ctx.beginPath(); ctx.roundRect(HX, y, HW, h, 22); ctx.fill();
    ctx.strokeStyle = rgba('#F4EFE6', .18); ctx.lineWidth = 2; ctx.stroke();
    ['#FF5A1F', '#8E877C', '#8E877C'].forEach((c, i) => dot(HX + 40 + i * 30, y + 38, 9, c));
    const typed = typeOn(v.text, inv(t0 + .25, t0 + .25 + Math.min(1.6, v.text.length * .05), lt));
    T('$ ' + typed, HX + 40, y + 140, { f: FM, w: 600, z: 44, c: '#F4EFE6', fit: HW - 80 });
    if (Math.floor(lt * 2) % 2 === 0){ const cx = HX + 40 + Math.min(HW - 80, mw('$ ' + typed, FM, 600, 44)) + 6; ctx.fillStyle = '#FF5A1F'; ctx.fillRect(cx, y + 104, 22, 46); }
    ctx.restore();
  },
  // one drawn icon and a short label, the icon drawn on stroke by stroke
  icon(v, th, lt, t0, tEnd, top, bottom){
    const p = inv(t0, t0 + .9, lt), s = Math.min(260, bottom - top - 40), x = HX, y = top;
    const draw = ICONS[v.icon]; if (!draw) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.strokeStyle = inkOf(th); ctx.lineWidth = 7 / s * 1.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([4 * eIO(p), 4]); draw(); ctx.restore();
    // The label lands mid-scene, a second change after the icon draws on.
    if (v.label) rise(v.label, x + s + 50, y + s / 2 + 20, lt, t0 + Math.max(.6, (tEnd - t0) * .45), { f: FD, w: 700, z: 56, c: th.ink, fit: HW - s - 50 });
    // a slow pulse ring keeps the illustration alive after it is drawn
    if (lt > t0 + 1){ const q = ((lt - t0 - 1) % 1.6) / 1.6; ctx.save(); ctx.strokeStyle = rgba(th.ink, .25 * (1 - q)); ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * (.55 + q * .25), 0, TAU); ctx.stroke(); ctx.restore(); }
  },
  // before and now, side by side: the old way dims and is struck, the new way lands
  versus(v, th, lt, t0, tEnd, top){
    const at = beats(2, t0, tEnd), cw = (HW - 40) / 2, h = 230;
    [[v.left, 'BEFORE'], [v.right, 'NOW']].forEach(([s, tag], i) => {
      const p = pop(lt, at[i]); if (p <= 0) return;
      const x = HX + i * (cw + 40), y = top + (1 - p) * 40, old = i === 0 && lt > at[1];
      ctx.save(); ctx.globalAlpha *= clamp(p * 1.6) * (old ? .55 : 1);
      ctx.strokeStyle = i ? inkOf(th) : rgba(th.ink, .5); ctx.lineWidth = 5; ctx.beginPath(); ctx.roundRect(x, y, cw, h, 20); ctx.stroke();
      T(tag, x + 30, y + 52, { f: FM, w: 700, z: 22, c: i ? inkOf(th) : th.dim, ls: 4 });
      const { lines, z } = wrapLines(s, FD, 700, 50, cw - 60, 3);
      lines.forEach((l, k) => T(l, x + 30, y + 112 + k * z * 1.08, { f: FD, w: 700, z, c: th.ink }));
      if (old){ ctx.fillStyle = th.ink; ctx.fillRect(x + 20, y + h / 2, (cw - 40) * inv(at[1], at[1] + .3, lt), 6); }
      ctx.restore();
    });
  },
};
// icons on a unit square, as strokes
const L = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); };
const C0 = (x, y, r, a = 0, b = TAU) => { ctx.beginPath(); ctx.arc(x, y, r, a, b); ctx.stroke(); };
const ICONS = {
  check: () => { C0(.5, .5, .45); L([[.28, .52], [.44, .67], [.73, .36]]); },
  shield: () => { L([[.5, .06], [.88, .2], [.84, .55], [.5, .94], [.16, .55], [.12, .2], [.5, .06]]); L([[.34, .5], [.46, .62], [.68, .38]]); },
  bug: () => { ctx.beginPath(); ctx.ellipse(.5, .58, .22, .3, 0, 0, TAU); ctx.stroke(); C0(.5, .22, .12); L([[.5, .3], [.5, .88]]); [[.28, .45, .08, .35], [.28, .62, .06, .62], [.28, .78, .1, .9], [.72, .45, .92, .35], [.72, .62, .94, .62], [.72, .78, .9, .9]].forEach(([a, b, c, e]) => L([[a, b], [c, e]])); },
  'chart-up': () => { L([[.08, .08], [.08, .92], [.92, .92]]); L([[.18, .74], [.4, .52], [.56, .64], [.86, .24]]); L([[.7, .24], [.86, .24], [.86, .4]]); },
  'chart-down': () => { L([[.08, .08], [.08, .92], [.92, .92]]); L([[.18, .26], [.4, .48], [.56, .36], [.86, .76]]); L([[.7, .76], [.86, .76], [.86, .6]]); },
  clock: () => { C0(.5, .5, .44); L([[.5, .22], [.5, .5], [.7, .62]]); },
  people: () => { C0(.34, .3, .13); C0(.7, .34, .11); ctx.beginPath(); ctx.arc(.34, .84, .26, Math.PI, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(.72, .84, .2, Math.PI * 1.05, TAU); ctx.stroke(); },
  agent: () => { ctx.beginPath(); ctx.roundRect(.14, .28, .72, .56, .12); ctx.stroke(); C0(.36, .54, .07); C0(.64, .54, .07); L([[.5, .28], [.5, .12]]); C0(.5, .09, .04); L([[.38, .72], [.62, .72]]); },
  merge: () => { C0(.28, .16, .08); C0(.28, .84, .08); C0(.74, .5, .08); L([[.28, .24], [.28, .76]]); ctx.beginPath(); ctx.moveTo(.28, .3); ctx.bezierCurveTo(.28, .5, .5, .5, .66, .5); ctx.stroke(); },
  doc: () => { L([[.22, .06], [.62, .06], [.8, .24], [.8, .94], [.22, .94], [.22, .06]]); L([[.62, .06], [.62, .24], [.8, .24]]); [.44, .6, .76].forEach(y => L([[.34, y], [.68, y]])); },
  search: () => { C0(.42, .42, .28); L([[.62, .62], [.9, .9]]); },
  money: () => { C0(.5, .5, .44); L([[.62, .32], [.42, .32], [.36, .4], [.42, .5], [.58, .5], [.64, .6], [.58, .68], [.36, .68]]); L([[.5, .2], [.5, .8]]); },
  terminal: () => { ctx.beginPath(); ctx.roundRect(.06, .16, .88, .68, .08); ctx.stroke(); L([[.2, .38], [.34, .5], [.2, .62]]); L([[.42, .64], [.66, .64]]); },
};
