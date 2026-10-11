// Workflow 2, basic renderer: script -> narration per scene -> measured timeline -> captions -> video -> R2.
// No music yet: music_ref stays null until a licensed track is chosen.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeShort, probe } from "./ffmpeg.js";
import type { MediaStore } from "./media.js";
import { SCRIPT_PROMPT_REVISION, writeScript } from "./script.js";
import { captionCues, timeline, toVtt } from "./timeline.js";
import { synthesize, TTS_MODEL } from "./tts.js";
import type { ReadyArtifact, RenderedVideo, ScriptScene } from "../types.js";

export interface RenderOptions {
  openaiKey: string;
  openaiModel?: string;
  geminiKey: string;
  ttsModel?: string;
  ttsVoice?: string;
  media: MediaStore;
  fetchImpl?: typeof fetch;
}

export async function renderArtifact(a: ReadyArtifact, o: RenderOptions): Promise<RenderedVideo> {
  const draft = await writeScript(a, { apiKey: o.openaiKey, model: o.openaiModel, fetchImpl: o.fetchImpl });
  const dir = await mkdtemp(join(tmpdir(), "resurface-render-"));
  try {
    // One clip per scene, so each scene's time comes from its own measured speech.
    const wavs: string[] = [];
    for (const [i, s] of draft.entries()) {
      const wav = join(dir, `scene-${i}.wav`);
      await writeFile(wav, await synthesize(s.narration_text, { apiKey: o.geminiKey, model: o.ttsModel, voice: o.ttsVoice, fetchImpl: o.fetchImpl }));
      wavs.push(wav);
    }
    const lengths = await Promise.all(wavs.map(async (w) => (await probe(w)).duration));
    const slots = timeline(lengths);

    const vtt = join(dir, "short.vtt");
    await writeFile(vtt, toVtt(captionCues(draft.map((s) => s.narration_text), slots)));
    const out = await composeShort({ dir, narration: wavs, onScreen: draft.map((s) => s.on_screen_text), slots, category: a.category });

    const base = `${a.id}/${a.version}`;
    const media_ref = await o.media.put(`videos/${base}/short.mp4`, out.mp4, "video/mp4");
    const caption_ref = await o.media.put(`captions/${base}/short.vtt`, vtt, "text/vtt; charset=utf-8");
    const narration_ref = await o.media.put(`audio/${base}/narration.m4a`, out.narration, "audio/mp4");

    const scenes: ScriptScene[] = draft.map((s, i) => ({
      start_seconds: slots[i].start, end_seconds: slots[i].end,
      narration_text: s.narration_text, on_screen_text: s.on_screen_text, visual_instruction: s.visual_instruction, source_ids: s.source_ids,
    }));
    return {
      script: { scenes },
      prompt_revision: `${SCRIPT_PROMPT_REVISION}; openai:${o.openaiModel ?? "default"}; tts:${o.ttsModel ?? TTS_MODEL}`,
      media_ref, caption_ref, narration_ref, duration_seconds: out.duration,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
