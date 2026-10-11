// Motion kit for generated shorts: timing helpers (M), shapes (K) and the Resurface reel look (E).
// Loaded into the render page before the model's FILM program. Everything here is a pure function of time.
window.M = (() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), lerp = (a, b, x) => a + (b - a) * x;
  const ease = {
    outCubic: (x) => 1 - Math.pow(1 - clamp(x), 3),
    inCubic: (x) => Math.pow(clamp(x), 3),
    inOutCubic: (x) => (x = clamp(x), x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outBack: (x) => { x = clamp(x); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
    outExpo: (x) => (x = clamp(x), x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inOutExpo: (x) => (x = clamp(x), x === 0 ? 0 : x === 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  };
  // Closed-form damped spring, 0 -> ~1, s seconds after it starts.
  const spring = (s, { freq = 2, damping = 0.6 } = {}) => {
    if (s <= 0) return 0;
    const w = 2 * Math.PI * freq, z = Math.min(damping, 0.999), wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * s) * (Math.cos(wd * s) + (z * w / wd) * Math.sin(wd * s));
  };
  const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let r = Math.imul(seed ^ seed >>> 15, 1 | seed); r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r; return ((r ^ r >>> 14) >>> 0) / 4294967296; };
  const beat = (t) => {
    const b = window.TIMELINE.beats; let i = b.findIndex((x) => t < x.end); if (i < 0) i = b.length - 1;
    const dur = b[i].end - b[i].start, local = t - b[i].start; return { i, p: clamp(local / dur), local, dur, start: b[i].start, end: b[i].end };
  };
  // Seconds since beat i started (negative before it).
  const since = (t, i) => t - window.TIMELINE.beats[i].start;
  return { clamp, lerp, ease, spring, rng, beat, since };
})();

// Drawing kit for canvas 2D: shapes the films reuse.
window.K = (() => {
  const C = { bg: "#0F1218", violet: "#7C5CFF", green: "#4CC38F", amber: "#F2B84B", sky: "#7FB2FF", coral: "#F08079", light: "#F6F6EF", dim: "#2A3040", ink: "#171B24" };
  const rr = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
  const glow = (ctx, color, blur) => { ctx.shadowColor = color; ctx.shadowBlur = blur; };
  const noGlow = (ctx) => { ctx.shadowBlur = 0; ctx.shadowColor = "transparent"; };

  function background(ctx, t, { gridAlpha = 0.06, drift = 1, seed = 7 } = {}) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, 1080, 1920);
    const g = ctx.createRadialGradient(540, 820, 100, 540, 820, 1200);
    g.addColorStop(0, "rgba(124,92,255,0.10)"); g.addColorStop(1, "rgba(15,18,24,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1920);
    ctx.strokeStyle = `rgba(246,246,239,${gridAlpha})`; ctx.lineWidth = 1;
    const off = (t * 18 * drift) % 90;
    ctx.beginPath();
    for (let x = -90 + off; x < 1170; x += 90) { ctx.moveTo(x, 0); ctx.lineTo(x, 1920); }
    for (let y = -90 + off; y < 2010; y += 90) { ctx.moveTo(0, y); ctx.lineTo(1080, y); }
    ctx.stroke();
    const r = M.rng(seed);
    for (let i = 0; i < 46; i++) {
      const x0 = r() * 1080, y0 = r() * 1920, sp = 10 + r() * 40, sz = 1 + r() * 2.5;
      const y = (y0 - t * sp * drift + 1920 * 4) % 1920;
      ctx.fillStyle = `rgba(246,246,239,${0.08 + 0.2 * r()})`;
      ctx.beginPath(); ctx.arc(x0 + Math.sin(t * 0.7 + i) * 8, y, sz, 0, 7); ctx.fill();
    }
  }

  function robot(ctx, x, y, s, { color = C.violet, blink = 0, arm = 0, eye = C.light, bob = 0, mood = 0 } = {}) {
    ctx.save(); ctx.translate(x, y + Math.sin(bob) * 6 * s); ctx.scale(s, s);
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, -78); ctx.lineTo(0, -102); ctx.stroke();
    ctx.fillStyle = C.amber; ctx.beginPath(); ctx.arc(0, -108, 9, 0, 7); ctx.fill();
    ctx.fillStyle = color; rr(ctx, -62, -80, 124, 96, 26); ctx.fill();
    ctx.fillStyle = C.ink; rr(ctx, -46, -64, 92, 60, 18); ctx.fill();
    const eh = 16 * (1 - blink) + 2;
    ctx.fillStyle = eye; rr(ctx, -30, -42 - eh / 2, 18, eh, 8); ctx.fill(); rr(ctx, 12, -42 - eh / 2, 18, eh, 8); ctx.fill();
    if (mood) { ctx.strokeStyle = eye; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -22, 10, 0.2, Math.PI - 0.2); ctx.stroke(); }
    ctx.fillStyle = color; rr(ctx, -46, 22, 92, 78, 20); ctx.fill();
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(0, 60, 14, 0, 7); ctx.fill();
    ctx.fillStyle = C.green; ctx.beginPath(); ctx.arc(0, 60, 7, 0, 7); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(-50, 36); ctx.lineTo(-50 - 30 * Math.cos(arm), 36 + 40 * Math.sin(arm + 0.9)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(50, 36); ctx.lineTo(50 + 30 * Math.cos(-arm), 36 + 40 * Math.sin(-arm + 0.9)); ctx.stroke();
    ctx.restore();
  }

  function human(ctx, x, y, s, { color = C.amber, wave = 0, bob = 0 } = {}) {
    ctx.save(); ctx.translate(x, y + Math.sin(bob) * 5 * s); ctx.scale(s, s);
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, -70, 34, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-58, 70); ctx.quadraticCurveTo(-58, -22, 0, -24); ctx.quadraticCurveTo(58, -22, 58, 70); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 14; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(44, 0); ctx.lineTo(44 + 40 * Math.cos(-1.1 - wave), 40 * Math.sin(-1.1 - wave)); ctx.stroke();
    ctx.fillStyle = C.ink; rr(ctx, -34, 14, 50, 34, 6); ctx.fill();
    ctx.restore();
  }

  function gear(ctx, x, y, r, rot, color = C.green, teeth = 10) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2, rad = i % 2 ? r : r * 1.22, a2 = a + Math.PI / (teeth * 2);
      ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); ctx.lineTo(Math.cos(a2) * rad, Math.sin(a2) * rad);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.bg; ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, 7); ctx.fill();
    ctx.restore();
  }

  function brackets(ctx, x, y, s, color = C.green, open = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.strokeStyle = color; ctx.lineWidth = 16; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const d = 30 + 20 * open;
    ctx.beginPath(); ctx.moveTo(-d, -50); ctx.lineTo(-d - 40, 0); ctx.lineTo(-d, 50); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d, -50); ctx.lineTo(d + 40, 0); ctx.lineTo(d, 50); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(14, -56); ctx.lineTo(-14, 56); ctx.stroke();
    ctx.restore();
  }

  function coin(ctx, x, y, r = 26, tilt = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.42 + 0.58 * (1 - tilt));
    ctx.fillStyle = "#B8861F"; ctx.beginPath(); ctx.ellipse(0, 8, r, r, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.amber; ctx.beginPath(); ctx.ellipse(0, 0, r, r, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = "#FFE29A"; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.62, r * 0.62, 0, 0, 7); ctx.stroke();
    ctx.restore();
  }

  function clock(ctx, x, y, r, a, color = C.coral) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = color; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    ctx.lineCap = "round"; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a / 12) * r * 0.45, Math.sin(a / 12) * r * 0.45); ctx.stroke();
    ctx.restore();
  }

  function bolt(ctx, x, y, s, color = C.sky) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(10, -60); ctx.lineTo(-30, 8); ctx.lineTo(0, 8); ctx.lineTo(-12, 60); ctx.lineTo(32, -12); ctx.lineTo(2, -12); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function shield(ctx, x, y, s, color = C.sky, fill = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.beginPath(); ctx.moveTo(0, -60); ctx.lineTo(50, -40); ctx.quadraticCurveTo(50, 30, 0, 64); ctx.quadraticCurveTo(-50, 30, -50, -40); ctx.closePath();
    ctx.fillStyle = color; ctx.globalAlpha *= fill; ctx.fill(); ctx.globalAlpha /= fill || 1;
    ctx.strokeStyle = C.light; ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-18, 2); ctx.lineTo(-4, 18); ctx.lineTo(22, -14); ctx.stroke();
    ctx.restore();
  }

  // Isometric cube centred at (x, y); faces: top, left, right colours.
  function cube(ctx, x, y, s, { top = C.violet, left = "#5B3FD9", right = "#4630B0", lift = 0, alpha = 1 } = {}) {
    const h = s * 0.5;
    ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y - lift);
    ctx.fillStyle = top; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.866, -h); ctx.lineTo(0, 0); ctx.lineTo(-s * 0.866, -h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = left; ctx.beginPath(); ctx.moveTo(-s * 0.866, -h); ctx.lineTo(0, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.866, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = right; ctx.beginPath(); ctx.moveTo(s * 0.866, -h); ctx.lineTo(0, 0); ctx.lineTo(0, s); ctx.lineTo(s * 0.866, h); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function star(ctx, x, y, r, rot = 0, color = C.amber) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rad = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function orb(ctx, x, y, r, color = C.violet, intensity = 1) {
    ctx.save();
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r * 2.2);
    g.addColorStop(0, color); g.addColorStop(0.45, color + "55"); g.addColorStop(1, color + "00");
    ctx.globalAlpha *= intensity; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, 7); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = C.light; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, 7); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, 7); ctx.fill();
    ctx.restore();
  }

  // Quick flash/whoosh transition overlay at a cut: strength 0..1.
  function flash(ctx, a, color = "#F6F6EF") { if (a <= 0) return; ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillRect(0, 0, 1080, 1920); ctx.restore(); }

  return { C, rr, glow, noGlow, background, robot, human, gear, brackets, coin, clock, bolt, shield, cube, star, orb, flash };
})();

// Editorial kit matching the Resurface hero reel: colour fields, kinetic type, HUD frame, synthesized SFX.
window.E = (() => {
  const P = { ink: "#0d0d0d", paper: "#f7f4ee", hot: "#ff5a1f", cream: "#efe8da", blue: "#2b3bff",
    green: "#2fbf71", amber: "#ffb703", sky: "#7fb2ff", coral: "#ff8a7a", violet: "#7c5cff" };
  const DISPLAY = '"Funnel Display", system-ui, sans-serif', SERIF = '"Instrument Serif", Georgia, serif', MONO = '"Martian Mono", ui-monospace, monospace';
  const tone = (bg) => ([P.ink, P.blue, P.hot].includes(bg) ? "dark" : "light");
  const fg = (bg) => (tone(bg) === "dark" ? P.paper : P.ink);

  function field(ctx, bg, t, { dots = true } = {}) {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 1080, 1920);
    if (!dots) return;
    ctx.fillStyle = tone(bg) === "dark" ? "rgba(247,244,238,0.07)" : "rgba(13,13,13,0.06)";
    for (let y = 30; y < 1920; y += 44) for (let x = 30; x < 1080; x += 44) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); }
  }

  // lines: [[{t:"LOOP"}, {t:"engineering?", serif:true, color}], ...]; reveals line by line from a mask.
  function headline(ctx, lines, { x = 80, y: y = 260, size: size0 = 170, color = P.ink, s = 0, stagger = 0.09, align = "left", lead = 0.92, serifScale = 1.08, out = 0 } = {}) {
    // Headlines ignore the imagery camera and use the global headline layout (E.HL) for the reel's safe area.
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    y = E.HL.y + (y - 330) * E.HL.scale; size0 *= E.HL.scale;
    // Shrink to fit the widest line inside the margins.
    let size = size0;
    for (const segs of lines) {
      const w = segs.reduce((n, g) => { ctx.font = g.serif ? `italic 400 ${size0 * serifScale}px ${SERIF}` : `800 ${size0}px ${DISPLAY}`; ctx.letterSpacing = g.serif ? "0px" : `${-0.045 * size0}px`; return n + ctx.measureText(g.t).width; }, 0) + size0 * 0.22 * (segs.length - 1);
      size = Math.min(size, size0 * (1080 - 2 * x) / w);
    }
    lines.forEach((segs, li) => {
      const lh = size * lead, top = y + li * lh;
      const k = M.spring(s - li * stagger, { freq: 2.1, damping: 0.78 });
      const o = M.ease.inCubic(out);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, top - lh * 0.95, 1080, lh * 1.25); ctx.clip();
      let widths = segs.map((g) => { ctx.font = g.serif ? `italic 400 ${size * serifScale}px ${SERIF}` : `800 ${size}px ${DISPLAY}`; return ctx.measureText(g.t).width; });
      const gap = size * 0.22, total = widths.reduce((a, b) => a + b, 0) + gap * (segs.length - 1);
      let cx = align === "center" ? 540 - total / 2 : align === "right" ? 1080 - x - total : x;
      const dy = (1 - k) * lh * 1.1 - o * lh * 1.2;
      segs.forEach((g, i) => {
        ctx.font = g.serif ? `italic 400 ${size * serifScale}px ${SERIF}` : `800 ${size}px ${DISPLAY}`;
        ctx.fillStyle = g.color ?? color; ctx.textBaseline = "alphabetic";
        if (!g.serif) ctx.letterSpacing = `${-0.045 * size}px`; else ctx.letterSpacing = "0px";
        ctx.fillText(g.t, cx, top + dy);
        g._x = cx; g._w = widths[i]; g._y = top + dy; g._size = size;
        cx += widths[i] + gap;
      });
      ctx.restore();
    });
    ctx.restore();
    return lines;
  }

  function strike(ctx, x1, x2, y, p, color = P.hot, w = 22) {
    if (p <= 0) return;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "butt";
    ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(M.lerp(x1, x2, M.ease.outExpo(p)), y); ctx.stroke(); ctx.restore();
  }

  function mono(ctx, text, x, y, { color, size = 22, align = "left", alpha = 1 } = {}) {
    ctx.save(); ctx.globalAlpha *= alpha; ctx.font = `500 ${size}px ${MONO}`; ctx.letterSpacing = `${0.14 * size}px`; ctx.textAlign = align;
    ctx.fillStyle = color; ctx.fillText(text.toUpperCase(), x, y); ctx.restore();
  }

  function chip(ctx, text, x, y, { bg = P.ink, color = P.paper, size = 22 } = {}) {
    ctx.save(); ctx.font = `500 ${size}px ${MONO}`; ctx.letterSpacing = `${0.12 * size}px`;
    const w = ctx.measureText(text.toUpperCase()).width + 44;
    ctx.fillStyle = bg; K.rr(ctx, x, y - size - 14, w, size + 30, 999); ctx.fill();
    ctx.fillStyle = color; ctx.fillText(text.toUpperCase(), x + 22, y + 2); ctx.restore();
    return w;
  }

  function hud(ctx, t, { bg, chapter, label = "Resurface · short", right = "From YouTube" }) {
    const c = tone(bg) === "dark" ? "rgba(247,244,238,0.75)" : "rgba(13,13,13,0.7)";
    ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 3;
    const L = 30, m = 40;
    [[m, m, 1, 1], [1080 - m, m, -1, 1], [m, 1920 - m, 1, -1], [1080 - m, 1920 - m, -1, -1]].forEach(([x, y, sx, sy]) => {
      ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke(); });
    ctx.restore();
    mono(ctx, label, 88, 66, { color: c });
    mono(ctx, chapter, 1080 - 88, 66, { color: c, align: "right" });
    const fps = 24, pad = (v) => String(v).padStart(2, "0");
    mono(ctx, `${pad(Math.floor(t / 60))}:${pad(Math.floor(t) % 60)}:${pad(Math.floor(t * fps) % fps)}`, 88, 1880, { color: c });
    mono(ctx, right, 1080 - 118, 1880, { color: c, align: "right" });
    if (Math.floor(t * 1.66) % 2 === 0) { ctx.save(); ctx.fillStyle = P.hot; ctx.beginPath(); ctx.arc(1080 - 96, 1871, 9, 0, 7); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
  }

  // Hard cut with a colour slab wipe across the first few frames of a beat.
  function wipe(ctx, s, color, dir = 1) {
    const p = M.clamp(s / 0.22);
    if (p >= 1) return;
    const x = dir > 0 ? M.lerp(0, 1080, M.ease.inOutExpo(p)) : M.lerp(1080, 0, M.ease.inOutExpo(p));
    ctx.save(); ctx.fillStyle = color;
    if (dir > 0) ctx.fillRect(x, 0, 1080 - x, 1920); else ctx.fillRect(0, 0, x, 1920);
    ctx.restore();
  }

  const HL = { y: 250, scale: 0.9 };
  // Imagery band: maps design y 680..1450 into roughly 430..1020, the part of the frame the reel overlay leaves clear.
  const stage = (ctx, fn) => { ctx.save(); ctx.translate(540, 475); ctx.scale(0.72, 0.72); ctx.translate(-540, -680); fn(); ctx.restore(); };
  return { HL, stage, P, DISPLAY, SERIF, MONO, tone, fg, field, headline, strike, mono, chip, hud, wipe };
})();
