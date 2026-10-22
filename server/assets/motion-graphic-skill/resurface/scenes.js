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
  const { lines, z: size } = wrapLines(text, FD, 800, z, width, 5), lh = size * 1.02;
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
function aside(text, x, y, lt, t0, th){
  const { lines, z } = wrapLines(text, FS, 'italic 400', 56, W - 2 * x, 3);
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
    const a = s.text, b = s.swap, y = 820; let z = 230;
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
    const rest = s.text.replace(m[0], ' ').replace(/\s+/g, ' ').trim(), y = 760;
    const shown = `${m[1]}${countText(m[2], inv(t0 + .05, t0 + 1.15, lt))}${m[3]}`, full = `${m[1]}${m[2]}${m[3]}`;
    let z = 330; while (mw(full, FD, 800, z) > HW && z > 120) z *= .94;
    rise(shown, HX, y, lt, t0, { f: FD, w: 800, z, c: th.ink }, .35, 60);
    if (!rest) return { bottom: y + z * .2, tEnd: t0 + 1.2 };
    return headline(rest, HX, y + 170, lt, t0 + .9, th, HW, 112, 1, { mode: 'slam' });
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
  const end = s.sub ? aside(s.sub, HX, h.bottom + 90, lt, h.tEnd + .25, th) : h.bottom;
  if (mv === 'stamp' && s.swap) stampBadge(s.swap.toUpperCase(), W - HX - 10, Math.min(1500, end + 170), lt, at.hit - .18, th);
}
const moveCues = (s, t0, d) => {
  const mv = s && s.move, at = s ? moveTimes(s, t0, d) : { hit: t0 };
  if (mv === 'strike') return [[at.hit, 'whoosh', .18, .12], [at.after, 'hit', .5]];
  if (mv === 'roll') return [[at.hit, 'roll', .5, 10], [at.after, 'whoosh', .2, .1]];
  if (mv === 'stamp') return [[at.hit, 'stamp', .7]];
  if (mv === 'count') return [[at.hit, 'roll', 1.1, 16], [at.after, 'hit', .5]];
  return [[t0 + .02, 'slam', .35]];
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

const openCut = d => Math.min(2.6, d * .45);
S.open = {
  draw(lt, d, t){
    const th = THEMES.night, src = DATA.source, cut = openCut(d);
    // 1) the saved source: tile, platform, title, author
    const out = eIO(inv(cut - .35, cut, lt)), up = out * 160;
    if (out < 1){
      const tp = spring(lt - .05, ...SPRING.playful);
      tile(W / 2, 560 - up, 240 * tp, src.kind, 1 - out);
      T(src.platform.toUpperCase(), W / 2, 740 - up, { f: FM, w: 600, z: 22, c: th.dim, ls: 4, al: 'center', a: inv(.3, .5, lt) * (1 - out) });
      const { lines, z } = wrapLines(src.title, FK, 700, 54, 860, 3);
      lines.forEach((l, i) => rise(l, W / 2, 850 + i * 66 - up, lt, .45 + i * .08, { f: FK, w: 700, z, c: th.ink, al: 'center', a: 1 - out }));
      rise(src.byline, W / 2, 850 + lines.length * 66 + 30 - up, lt, .8, { f: FS, w: 'italic 400', z: 48, c: th.acc, al: 'center', a: 1 - out });
      kicker('SAVED FOR LATER', W / 2, 400 - up, lt, .1, th.dim, 'center');
    }
    // 2) what it says, landing with the scene's move
    if (lt > cut - .1){
      label(DATA.category.toUpperCase(), 90, 330, lt, cut, th.acc);
      lesson(dataOf(t), th, lt, cut + .05, d);
    }
  },
  cues: d => [[0, 'whoosh', .3, .12], [.05, 'blip', 880, .05], [openCut(d), 'whoosh', .25, .1], ...moveCues(DATA.scenes[0], openCut(d) + .05, d)]
};

S.say = {
  draw(lt, d, t){
    const sc = sceneAt(t), th = themeOf(sc), s = dataOf(t);
    // a big ghost step number sits behind the copy, low, so captions over the middle stay clear
    T(String(sc.i).padStart(2, '0'), W - 90, 1560, { f: FD, w: 800, z: 520, c: rgba(th.ink, .07), al: 'right', a: inv(.1, .5, lt) });
    label(`LESSON ${String(sc.i).padStart(2, '0')}${s.label ? ` · ${s.label.toUpperCase()}` : ''}`, 90, 330, lt, .15, th.acc === th.ink ? th.ink : th.acc);
    lesson(s, th, lt, .25, d);
  },
  cues: (d, sc) => [[.25, 'whoosh', .22, .08], ...moveCues(DATA.scenes[sc.i], .25, d)]
};

S.skill = {
  draw(lt, d, t){
    const th = THEMES.paper, sk = DATA.skill;
    const h = headline(sk ? sk.name.replace(/-/g, ' ') : dataOf(t).text, 90, 400, lt, .35, th, W - 180, 88, 1);
    if (sk) aside(sk.description, 90, h.bottom + 85, lt, h.tEnd + .1, th);
  },
  cues: d => [[.1, 'blip', 990, .06], [d - .9, 'correct']]
};
