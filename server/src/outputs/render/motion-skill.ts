// Workflow 2, motion renderer: the same script and narration as the basic renderer, drawn with motion-graphic-skill
// (github.com/JakeB-5/motion-graphic-skill, vendored in server/assets/motion-graphic-skill) in the Resurface reel style.
// The skill's record.js paints every frame of the template in headless Chromium with the engine's own soundtrack;
// ffmpeg then lays the narration over it, ducking the music under the voice.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probe, run } from "./ffmpeg.js";
import type { Slot } from "./timeline.js";
import type { ReadyArtifact } from "../types.js";

export const MOTION_SKILL_REVISION = "visuals:motion-graphic-skill";
export const MOTION_MUSIC_PROVENANCE =
  "motion-graphic-skill engine soundtrack: synthesised with Web Audio oscillators at render time; no audio files, recordings or samples.";

// server/assets/motion-graphic-skill, from src/outputs/render or dist/outputs/render.
const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../assets/motion-graphic-skill");
/** Painting ~1,350 frames on a small container takes minutes; a hung browser still ends. */
const RECORD_TIMEOUT_MS = 40 * 60_000;

/** The ready skill an end card can name; null while it's still being written or if it failed. */
export interface SkillCard { name: string; tasks: number }

export interface MotionScene { d: number; code: string; theme: string; text: string; sub: string; label: string }
export interface MotionSpec {
  id: string;
  category: string;
  source: { kind: "x" | "youtube" | "other"; platform: string; title: string; byline: string; tag: string };
  scenes: MotionScene[];
  skill: { name: string; path: string; tasks: string } | null;
}

const THEMES = ["night", "signal", "paper"];
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** At most max characters, cut at a word boundary when there is one. */
const clip = (s: string, max: number) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
};
/** X post text as ingest stored it: the first 80 characters (src/ingest/extract/xpost.ts), so a full-length one was cut. */
const X_TITLE_CHARS = 80;
const firstSentence = (s: string) => oneLine(s).match(/^.*?[.!?](?=\s|$)/)?.[0] ?? oneLine(s);

function sourceOf(a: ReadyArtifact): MotionSpec["source"] {
  const first = a.sources[0];
  const host = (() => { try { return new URL(first?.url ?? "").hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const kind = /(^|\.)(x|twitter)\.com$/.test(host) ? "x" : /(^|\.)(youtube\.com|youtu\.be)$/.test(host) ? "youtube" : "other";
  const platform = kind === "x" ? "X" : kind === "youtube" ? "YouTube" : /substack\.com$/.test(host) ? "Substack" : host || "Source";
  // X titles are stored as "@handle: text"; the handle is the byline.
  const raw = oneLine(first?.title ?? "");
  const m = kind === "x" ? raw.match(/^(@\w{1,15}):\s*(.*)$/) : null;
  const more = a.sources.length > 1 ? ` · ${a.sources.length} SOURCES` : "";
  const text = m ? (m[2].length >= X_TITLE_CHARS ? clip(`${m[2]} `, m[2].length) : m[2]) : raw || a.name;
  return { kind, platform, title: clip(text, 110), byline: m ? m[1] : "", tag: `${platform.toUpperCase()}${more}` };
}

/** The template's data: one entry per narrated scene, timed to its measured narration slot. */
export function motionSpec(a: ReadyArtifact, scenes: { on_screen_text: string; narration_text: string }[], slots: Slot[], skill: SkillCard | null): MotionSpec {
  const last = scenes.length - 1;
  return {
    id: a.id.slice(0, 8),
    category: oneLine(a.category ?? a.name),
    source: sourceOf(a),
    scenes: scenes.map((s, i) => {
      const text = clip(oneLine(s.on_screen_text), 90), sub = clip(firstSentence(s.narration_text), 140);
      return {
        d: Math.round((slots[i].end - slots[i].start) * 100) / 100,
        code: i === 0 ? "SAVED" : i === last ? "SKILL" : "LESSON",
        theme: i === last && last > 0 ? "paper" : THEMES[i % THEMES.length],
        text, sub: i === last || sub.toLowerCase() === text.toLowerCase() ? "" : sub, label: "",
      };
    }),
    skill: skill && {
      name: skill.name, path: `.agents/skills/${skill.name}/SKILL.md`,
      tasks: skill.tasks > 0 ? `${skill.tasks} TASK${skill.tasks === 1 ? "" : "S"} READY` : "",
    },
  };
}

/** The template with this short's data in place. "<" is escaped so no source text can close the script tag. */
export function fillTemplate(template: string, spec: MotionSpec): string {
  const json = JSON.stringify(spec).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  if (!template.includes("/*DATA*/null")) throw new Error("motion template has no DATA placeholder; run assets/motion-graphic-skill/build-template.sh");
  return template.replace("/*DATA*/null", () => json);
}

const RECORD_ENV = ["PATH", "HOME", "TMPDIR", "LANG", "TZ", "FONTCONFIG_PATH", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"];

/**
 * The environment record.js (and so Chromium) runs with: only what it, Chromium and ffmpeg need, never the
 * processor's keys or DATABASE_URL, since Chromium runs without its sandbox in the container. CHROME is the given
 * one, else the container's wrapper (adds --no-sandbox), else record.js finds a Chrome itself.
 */
export function recordEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = Object.fromEntries(RECORD_ENV.filter((n) => env[n] !== undefined).map((n) => [n, env[n]]));
  if (env.CHROME) out.CHROME = env.CHROME;
  else if (existsSync("/usr/bin/chromium")) out.CHROME = join(SKILL_DIR, "chromium-no-sandbox.sh");
  return out;
}

/**
 * Records the template with this spec to film.mp4 (picture + the engine's music), then mixes narration.wav over it
 * into short.mp4: the music is ducked under the voice and the whole mix is normalised to -14 LUFS.
 */
export async function renderMotion(dir: string, spec: MotionSpec, narrationWav: string): Promise<{ mp4: string; duration: number }> {
  const html = join(dir, "short.html"), film = join(dir, "film.mp4"), mp4 = join(dir, "short.mp4");
  await writeFile(html, fillTemplate(await readFile(join(SKILL_DIR, "resurface-short.html"), "utf8"), spec));
  await runWithEnv(process.execPath, [join(SKILL_DIR, "scripts", "record.js"), html, "--out", film, "--crf", "20"], recordEnv());
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-i", film, "-i", narrationWav, "-filter_complex",
    "[0:a]volume=0.32[m];[1:a]aresample=48000,asplit=2[v][v2];[m][v]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=350[md];" +
      "[md][v2]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]",
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", mp4,
  ]);
  const p = await probe(mp4);
  if (p.video?.codec !== "h264" || p.video.width !== 1080 || p.video.height !== 1920) throw new Error(`motion short is not 1080x1920 H.264 (${JSON.stringify(p.video)})`);
  if (p.audio?.codec !== "aac") throw new Error("motion short has no AAC audio track");
  return { mp4, duration: Math.round(p.duration * 100) / 100 };
}

/** One narration track on the scene timeline: each clip, then silence to its slot's end. Writes WAV and M4A. */
export async function narrationTrack(dir: string, wavs: string[], slots: Slot[]): Promise<{ wav: string; m4a: string }> {
  const wav = join(dir, "narration.wav"), m4a = join(dir, "narration.m4a");
  const pads = wavs.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,apad=whole_dur=${(slots[i].end - slots[i].start).toFixed(3)}[a${i}]`);
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", ...wavs.flatMap((w) => ["-i", w]),
    "-filter_complex", `${pads.join(";")};${wavs.map((_, i) => `[a${i}]`).join("")}concat=n=${wavs.length}:v=0:a=1,asplit=2[w][m]`,
    "-map", "[w]", "-c:a", "pcm_s16le", wav, "-map", "[m]", "-c:a", "aac", "-b:a", "96k", m4a,
  ]);
  return { wav, m4a };
}

function runWithEnv(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((done, reject) => {
    const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const keep = (d: Buffer) => { tail = (tail + d.toString()).slice(-2000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    // SIGTERM first: puppeteer's handler closes the Chromium it launched (its own process group) before exiting.
    let kill: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      tail += `\nrecord.js timed out after ${RECORD_TIMEOUT_MS / 60_000} minutes`;
      child.kill("SIGTERM");
      kill = setTimeout(() => child.kill("SIGKILL"), 15_000);
    }, RECORD_TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`record.js could not start: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(kill);
      // record.js prints "verified: …" last only when the MP4 is playable and as long as the film.
      if (code === 0 && /verified:/.test(tail)) done();
      else reject(new Error(`motion-graphic-skill record.js failed (exit ${code}): ${tail.trim().split("\n").slice(-3).join(" ").slice(0, 400)}`));
    });
  });
}
