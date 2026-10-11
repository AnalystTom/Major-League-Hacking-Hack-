// Composes the 1080x1920 short: one text frame per scene over the measured narration, H.264 + AAC, faststart.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { wrap, type Slot } from "./timeline.js";

const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
];

/** RENDER_FONT, else a bold system font; null means fontconfig's default sans. */
export function fontFile(font = process.env.RENDER_FONT): string | null {
  return font ?? FONT_CANDIDATES.find((f) => existsSync(f)) ?? null;
}

/**
 * The drawtext font option. The font is copied into the render dir first, so its path in the filter graph is
 * always the plain temp path: a RENDER_FONT containing ':', '\\' or quotes can't break the graph.
 */
async function fontOption(dir: string): Promise<string> {
  const src = fontFile();
  if (!src) return "font='Sans'";
  const local = join(dir, `font${extname(src).replace(/[^.\w]/g, "")}`);
  await copyFile(src, local);
  return `fontfile='${local}'`;
}

export function run(cmd: string, args: string[], { timeoutMs = 300_000, cwd }: { timeoutMs?: number; cwd?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`${cmd} could not start: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited ${code}: ${err.trim().split("\n").slice(-3).join(" ").slice(0, 400)}`));
    });
  });
}

export interface Probe { duration: number; video: { codec: string; width: number; height: number } | null; audio: { codec: string } | null }

export async function probe(path: string): Promise<Probe> {
  const out = JSON.parse(await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", path]));
  const streams: any[] = out.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  return {
    duration: Number(out.format?.duration),
    video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
    audio: a ? { codec: a.codec_name } : null,
  };
}

/** About 34 bold capitals fit across the frame at the header size, so a long category gets its own clipped line. */
export function headerText(category: string | null, max = 34): string {
  const cat = (category ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!cat) return "RESURFACE";
  return `RESURFACE\n${cat.length > max ? `${cat.slice(0, max - 1).trimEnd()}…` : cat}`;
}

export interface ComposeInput {
  dir: string;
  /** One WAV per scene, in order. */
  narration: string[];
  onScreen: string[];
  slots: Slot[];
  category: string | null;
}

/** Writes short.mp4 and narration.m4a into dir and returns their paths and the probed duration. */
export async function composeShort(c: ComposeInput): Promise<{ mp4: string; narration: string; duration: number }> {
  const total = c.slots.at(-1)!.end;
  const font = await fontOption(c.dir);
  const gap = (c.slots[0].end - c.slots[0].speechEnd).toFixed(3);

  const header = join(c.dir, "header.txt");
  await writeFile(header, headerText(c.category));
  const texts = await Promise.all(c.onScreen.map(async (t, i) => {
    const p = join(c.dir, `scene-${i}.txt`);
    await writeFile(p, wrap(t, 16));
    return p;
  }));

  const audio = c.narration.map((_, i) => `[${i + 1}:a]aresample=48000,apad=pad_dur=${gap}[a${i}]`).join(";");
  const joined = `${c.narration.map((_, i) => `[a${i}]`).join("")}concat=n=${c.narration.length}:v=0:a=1,asplit=2[aout][anar]`;
  const scenes = texts.map((p, i) => {
    const s = c.slots[i].start.toFixed(3), e = c.slots[i].end.toFixed(3);
    return `drawtext=${font}:textfile='${p}':expansion=none:fontsize=96:fontcolor=white:line_spacing=24:` +
      `x=(w-text_w)/2:y=(h-text_h)/2-260+max(0\\,48*(1-(t-${s})/0.35)):alpha='min(1,max(0,(t-${s})/0.35))':enable='between(t,${s},${e})'`;
  });
  const video = [
    "[0:v]drawbox=x=96:y=200:w=140:h=12:color=0x7C5CFF:t=fill",
    `drawtext=${font}:textfile='${header}':expansion=none:fontsize=36:fontcolor=0xB8C0CC:line_spacing=14:x=96:y=240`,
    ...scenes,
  ].join(",") + "[vout]";

  const mp4 = join(c.dir, "short.mp4");
  const narration = join(c.dir, "narration.m4a");
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=0x0F1218:s=1080x1920:r=30:d=${total.toFixed(3)}`,
    ...c.narration.flatMap((p) => ["-i", p]),
    "-filter_complex", `${audio};${joined};${video}`,
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-t", total.toFixed(3), mp4,
    "-map", "[anar]", "-c:a", "aac", "-b:a", "96k", narration,
  ]);

  const p = await probe(mp4);
  if (p.video?.codec !== "h264" || p.video.width !== 1080 || p.video.height !== 1920) throw new Error(`rendered video is not 1080x1920 H.264 (${JSON.stringify(p.video)})`);
  if (p.audio?.codec !== "aac") throw new Error("rendered video has no AAC narration track");
  if (!(p.duration > 0) || Math.abs(p.duration - total) > 1) throw new Error(`rendered duration ${p.duration}s doesn't match the ${total}s timeline`);
  return { mp4, narration, duration: Math.round(p.duration * 100) / 100 };
}
