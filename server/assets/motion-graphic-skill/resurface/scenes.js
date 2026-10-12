// Scenes read DATA (written per short by server/src/outputs/render/motion-skill.ts): the source, one entry per narration scene, and the skill it became.
const dataOf = t => DATA.scenes[sceneAt(t).i];

// a mono kicker that types on and shrinks to fit the safe width (long categories)
function label(s, x, y, lt, t0, c, al = 'left'){ T(typeOn(s, inv(t0, t0 + .32, lt)), x, y, { f: FM, w: 700, z: 22, c, ls: 4, al, fit: W - 2 * 90 }); }

// headline: words land one after another (heavy display), then an underline springs out under the last line
function headline(text, x, y, lt, t0, th, width = W - 2 * x, z = 132, span = 1.4){
  const { lines, z: size } = wrapLines(text, FD, 800, z, width, 5), lh = size * 1.02;
  const words = lines.flatMap((l, li) => l.split(' ').map((w, wi, arr) => ({ w, li, pre: arr.slice(0, wi).join(' ') + (wi ? ' ' : '') })));
  const step = Math.min(.16, span / Math.max(1, words.length));
  words.forEach((wd, k) => { const t1 = t0 + k * step, p = spring(lt - t1, ...SPRING.heavy); if (lt < t1) return;
    const wx = x + mw(wd.pre, FD, 800, size), wy = y + wd.li * lh;
    T(wd.w, wx, wy + (1 - p) * 46, { f: FD, w: 800, z: size, c: th.ink, a: clamp(p * 1.6) }); });
  const tEnd = t0 + words.length * step, last = lines[lines.length - 1], ul = spring(lt - tEnd, ...SPRING.snappy);
  if (ul > 0){ ctx.fillStyle = th.acc; ctx.fillRect(x, y + (lines.length - 1) * lh + size * .28, mw(last, FD, 800, size) * Math.min(1, ul), 14); }
  return { bottom: y + (lines.length - 1) * lh + size * .28 + 14, tEnd };
}

// the italic serif aside under a headline, wrapped to at most 3 lines
function aside(text, x, y, lt, t0, th){
  const { lines, z } = wrapLines(text, FS, 'italic 400', 56, W - 2 * x, 3);
  lines.forEach((l, i) => rise(l, x, y + i * z * 1.12, lt, t0 + i * .08, { f: FS, w: 'italic 400', z, c: th.ink }));
}

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
    const th = THEMES.night, src = DATA.source, cut = Math.min(2.6, d * .45);
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
    // 2) what it says
    if (lt > cut - .1){
      label(DATA.category.toUpperCase(), 90, 330, lt, cut, th.acc);
      const h = headline(dataOf(t).text, 90, 470, lt, cut + .05, th);
      if (dataOf(t).sub) aside(dataOf(t).sub, 90, h.bottom + 90, lt, h.tEnd + .2, th);
    }
  },
  cues: d => [[0, 'whoosh', .3, .12], [.05, 'blip', 880, .05], [Math.min(2.6, d * .45), 'whoosh', .25, .1]]
};

S.say = {
  draw(lt, d, t){
    const sc = sceneAt(t), th = themeOf(sc), s = dataOf(t);
    // a big ghost step number sits behind the copy, low, so captions over the middle stay clear
    T(String(sc.i).padStart(2, '0'), W - 90, 1560, { f: FD, w: 800, z: 520, c: rgba(th.ink, .07), al: 'right', a: inv(.1, .5, lt) });
    label(`LESSON ${String(sc.i).padStart(2, '0')}${s.label ? ` · ${s.label.toUpperCase()}` : ''}`, 90, 330, lt, .15, th.acc === th.ink ? th.ink : th.acc);
    const h = headline(s.text, 90, 470, lt, .25, th);
    if (s.sub) aside(s.sub, 90, h.bottom + 90, lt, h.tEnd + .25, th);
  },
  cues: d => [[.25, 'whoosh', .22, .08]]
};

S.skill = {
  draw(lt, d, t){
    const th = THEMES.paper, sk = DATA.skill;
    // SKILL.md chip; without a ready skill the card is just the next step
    const chip = sk ? 'SKILL.md' : 'NEXT STEP', cp = spring(lt - .1, ...SPRING.snappy), cw = mw(chip, FM, 600, 26, 2) + 56;
    ctx.save(); ctx.globalAlpha = clamp(cp * 1.5); ctx.strokeStyle = th.ink; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(90, 300 - 44 + (1 - cp) * 20, cw, 62, 31); ctx.stroke(); ctx.restore();
    T(chip, 90 + 28, 300 + (1 - cp) * 20, { f: FM, w: 600, z: 26, c: th.ink, ls: 2, a: clamp(cp * 1.5) });
    // the skill's name, as it lands in .agents/skills/<name>/
    // without a ready skill (it's still being written) the card names the lesson instead: no invented path or count
    const h = headline(sk ? sk.name.replace(/-/g, ' ') : dataOf(t).text, 90, 470, lt, .35, th, W - 180, 112, 1);
    if (sk){
      rise(sk.path, 90, h.bottom + 70, lt, h.tEnd + .1, { f: FM, w: 400, z: 24, c: th.dim, fit: W - 180 });
      rise(dataOf(t).text, 90, h.bottom + 170, lt, h.tEnd + .3, { f: FS, w: 'italic 400', z: 64, c: th.ink, fit: W - 180 });
    }
    // the stamp: rotated outline badge, slams in
    const t1 = Math.min(d * .5, h.tEnd + .9), sp = inv(t1, t1 + .18, lt);
    if (sk && sp > 0){
      const sc = lerp(1.6, 1, eBack(sp)), label = 'SEND TO YOUR AGENT', bw = mw(label, FD, 800, 50) + 64;
      ctx.save(); ctx.translate(W - 90 - bw / 2 - 10, 1150); ctx.rotate(-.12); ctx.scale(sc, sc); ctx.globalAlpha = clamp(sp * 2);
      ctx.strokeStyle = th.acc; ctx.lineWidth = 7; ctx.beginPath(); ctx.roundRect(-bw / 2, -50, bw, 100, 18); ctx.stroke();
      T(label, 0, 18, { f: FD, w: 800, z: 50, c: th.acc, al: 'center' }); ctx.restore();
      if (sk && sk.tasks) rise(sk.tasks, W - 100, 1290, lt, t1 + .35, { f: FM, w: 600, z: 24, c: th.ink, ls: 3, al: 'right' });
    }
  },
  cues: d => [[.1, 'blip', 990, .06], [Math.min(d * .5, 2.2), 'stamp', .6], [d - .9, 'correct']]
};
