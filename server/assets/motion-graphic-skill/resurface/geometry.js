// Greedy word wrap for headlines: lines that fit `width` at size z (returns the lines and the size actually used).
function wrapLines(s, f, w, z, width, maxLines = 4){
  for (let size = z; size >= z * .55; size *= .94){
    const words = s.split(/\s+/).filter(Boolean), lines = []; let cur = '';
    for (const word of words){ const next = cur ? cur + ' ' + word : word;
      if (mw(next, f, w, size) <= width || !cur) cur = next; else { lines.push(cur); cur = word; } }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines && lines.every(l => mw(l, f, w, size) <= width)) return { lines, z: size };
  }
  return { lines: [s], z: z * .55 };
}
