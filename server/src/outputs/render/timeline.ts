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

/** Splits each scene's narration into short cues, spread over its measured speech by length. */
export function captionCues(narration: string[], slots: Slot[], maxChars = 42): Cue[] {
  const cues: Cue[] = [];
  narration.forEach((text, i) => {
    const chunks = wrapLines(text, maxChars);
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
