// Scene times and caption cues, derived from each scene's measured narration length.

/** Silence after each scene's narration, so scene changes don't clip speech. */
export const SCENE_GAP_SECONDS = 0.35;

export interface Slot { start: number; end: number; speechEnd: number }

const round = (n: number) => Math.round(n * 1000) / 1000;

export function timeline(speechSeconds: number[]): Slot[] {
  let t = 0;
  return speechSeconds.map((d, i) => {
    if (!Number.isFinite(d) || d <= 0) throw new Error(`narration clip has no measurable length (${d})`);
    const duration = i === speechSeconds.length - 1 ? Math.max(2.5, d + SCENE_GAP_SECONDS) : d + SCENE_GAP_SECONDS;
    const slot = { start: round(t), speechEnd: round(t + d), end: round(t + duration) };
    t += duration;
    return slot;
  });
}

export interface Cue { start: number; end: number; text: string }

/**
 * Splits each scene's narration into one-line cues of at most maxChars, spread over its measured speech by length.
 * Deterministic: cues break after punctuation first, and never end on a word that leads into the next one.
 */
export function captionCues(narration: string[], slots: Slot[], maxChars = 26): Cue[] {
  const cues: Cue[] = [];
  narration.forEach((text, i) => {
    const chunks = phrases(text, maxChars);
    const { start, speechEnd } = slots[i];
    const total = chunks.reduce((n, c) => n + c.length, 0);
    let t = start;
    for (const c of chunks) {
      const end = t + ((speechEnd - start) * c.length) / total;
      cues.push({ start: round(t), end: round(end), text: c });
      t = end;
    }
  });
  return cues;
}

/** Words a caption line shouldn't end on: they belong with what follows ("fell by / more than"). */
const LEADING = new Set("a an the of to by in on at for from with and or but than more most less as into onto per via your our their its this that these those is are was were be".split(" "));

/** One-line caption phrases: a clause per cue when it fits, else the most balanced split that keeps phrases together. */
export function phrases(text: string, maxChars: number): string[] {
  return text.replace(/\s+/g, " ").trim().split(/(?<=[.,;:!?])\s+/).filter(Boolean).flatMap((clause) => splitClause(clause.split(" "), maxChars));
}

/** Lowest-cost split of one clause into lines of at most maxChars (a longer single word stays whole). */
function splitClause(words: string[], maxChars: number): string[] {
  const n = words.length, len = (i: number, j: number) => words.slice(i, j).join(" ").length;
  const lines = Math.ceil(len(0, n) / maxChars), target = len(0, n) / lines;
  // A break after word j-1 is bad when that word leads into the next, or splits a number from its unit.
  const badBreak = (j: number) => j < n && (LEADING.has(words[j - 1].toLowerCase().replace(/[^a-z]/g, "")) || /(\d|^(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)[-a-z]*)$/i.test(words[j - 1]) && /^(percent|%|x|times|ms|s|seconds|minutes|hours|days|weeks|months|years|k|m|b|gb|tb|tok)/i.test(words[j]));
  const best: { cost: number; prev: number }[] = [{ cost: 0, prev: -1 }];
  for (let j = 1; j <= n; j++) {
    best[j] = { cost: Infinity, prev: -1 };
    for (let i = 0; i < j; i++) {
      const l = len(i, j);
      if (l > maxChars && j - i > 1) continue;
      const cost = best[i].cost + (l - target) ** 2 + 30 + (badBreak(j) ? 400 : 0) + (j - i === 1 && n > 2 ? 150 : 0);
      if (cost < best[j].cost) best[j] = { cost, prev: i };
    }
  }
  const out: string[] = [];
  for (let j = n; j > 0; j = best[j].prev) out.unshift(words.slice(best[j].prev, j).join(" "));
  return out;
}

const stamp = (s: number) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};

export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.replace(/-->/g, "→")}\n`).join("\n")}`;
}

/** Greedy word wrap into lines of at most maxChars; a word longer than the line stays whole. */
function wrapLines(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last !== undefined && (last + " " + word).length <= maxChars) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** On-screen text wrapped for drawtext. Caption cues use the same wrapping, one line per cue. */
export function wrap(text: string, maxChars: number): string {
  return wrapLines(text, maxChars).join("\n");
}
