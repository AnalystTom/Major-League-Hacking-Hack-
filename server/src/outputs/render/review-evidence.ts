import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScriptScene } from "../types.js";
import { run } from "./ffmpeg.js";

export async function reviewEvidence(mp4: string, dir: string, scenes: ScriptScene[], motion: boolean) {
  const images: string[] = [], names: string[] = [];
  const add = async (file: string, name: string) => {
    images.push(`data:image/${file.endsWith(".png") ? "png" : "jpeg"};base64,${(await readFile(file)).toString("base64")}`);
    names.push(name);
  };
  if (motion) {
    const check = join(dir, "motion-check");
    for (const name of (await readdir(check)).sort()) {
      if (/^(sheet-|strip-|still-|view-).*\.png$/.test(name)) await add(join(check, name), name);
    }
  }
  const strips = [{ name: "finished-opening.jpg", start: 0, seconds: 2.4, fps: 5 },
    ...scenes.slice(1).map((scene, i) => ({ name: `finished-cut-${i + 1}.jpg`, start: Math.max(0, scene.start_seconds - 4 / 30), seconds: .4, fps: 30 }))];
  for (const strip of strips) {
    const file = join(dir, strip.name);
    await run("ffmpeg", ["-y", "-v", "error", "-ss", String(strip.start), "-i", mp4, "-t", String(strip.seconds),
      "-vf", `fps=${strip.fps},scale=180:320,tile=6x2:nb_frames=12`, "-frames:v", "1", file]);
    await add(file, `${strip.name}: t=${strip.start}, ${1 / strip.fps}s per frame`);
  }
  const timestamps = scenes.flatMap(scene => {
    const duration = scene.end_seconds - scene.start_seconds;
    return [scene.start_seconds + Math.min(1, duration / 3), scene.start_seconds + duration * 2 / 3];
  });
  const last = scenes.at(-1)!;
  timestamps.push(last.end_seconds - Math.min(.1, (last.end_seconds - last.start_seconds) / 2));
  const frames: string[] = [];
  for (const [i, timestamp] of timestamps.entries()) {
    const frame = join(dir, `judge-${String(i).padStart(2, "0")}.jpg`);
    await run("ffmpeg", ["-y", "-v", "error", "-ss", String(timestamp), "-i", mp4, "-frames:v", "1", "-vf", "scale=390:694", "-pix_fmt", "yuvj420p", frame]);
    frames.push(frame);
  }
  const phone = join(dir, "finished-phone.jpg");
  await run("ffmpeg", ["-y", "-v", "error", "-i", join(dir, "judge-%02d.jpg"), "-vf",
    `scale=360:640,tile=4x${Math.ceil(frames.length / 4)}:nb_frames=${frames.length}`, "-frames:v", "1", phone]);
  await add(phone, "finished-phone.jpg: 360px-wide stills in frame_times_seconds order");
  for (const [i, file] of frames.entries()) await add(file, `finished-frame-${i}.jpg @ ${timestamps[i]}s`);
  const audio = [];
  for (const [i, scene] of scenes.entries()) {
    const output = await run("ffmpeg", ["-v", "error", "-ss", String(scene.start_seconds), "-t", String(scene.end_seconds - scene.start_seconds), "-i", mp4,
      "-af", "astats=metadata=1:reset=0,ametadata=print:file=-", "-f", "null", "-"]);
    const level = (key: string) => Number([...output.matchAll(new RegExp(`lavfi.astats.Overall.${key}=([^\\r\\n]+)`, "g"))].at(-1)?.[1]);
    const rms_db = level("RMS_level"), peak_db = level("Peak_level");
    if (!Number.isFinite(rms_db) || !Number.isFinite(peak_db)) throw new Error(`No measurable finished audio in scene ${i}`);
    audio.push({ scene: i, rms_db, peak_db, passed: rms_db >= -34 && peak_db < -.1 });
  }
  return { images, names, timestamps, audio };
}
