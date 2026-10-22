// Workflow 2: script -> narration per scene -> measured timeline -> captions -> video -> R2.
// The picture is drawn with motion-graphic-skill (motion-skill.ts) unless RENDER_STYLE=basic, which keeps the plain
// ffmpeg text cards; both use the same script, narration and captions.

import { reasoningEffort } from "../../openaiEffort.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_DIGEST_MODEL } from "../../ingest/digest/run.js";
import { judgeShort } from "./judge.js";
import { burnSubtitles, composeShort, probe } from "./ffmpeg.js";
import type { MediaStore } from "./media.js";
import { SCRIPT_PROMPT_REVISION, writeScript } from "./script.js";
import { captionCues, timeline, toVtt } from "./timeline.js";
import { synthesize, TTS_MODEL } from "./tts.js";
import { MOTION_MUSIC_PROVENANCE, MOTION_SKILL_REVISION, motionSpec, narrationTrack, renderMotion, type SkillCard } from "./motion-skill.js";
import type { SkillState } from "../store.js";
import type { ProviderOptions, ReadyArtifact, RenderedVideo, ScriptScene } from "../types.js";

/** The provider settings, with the two keys a render can't run without, and where the files go. */
export interface RenderOptions extends ProviderOptions {
  openaiKey: string;
  geminiKey: string;
  media: MediaStore;
  /** The artifact's skill, so a motion short's end card can name it (OutputStore.skillCard). */
  skillCard?: (a: ReadyArtifact) => Promise<SkillState>;
  /** How long a motion render waits for a skill still being written before ending without one. */
  skillWaitMs?: number;
}

export const renderStyle = () => (process.env.RENDER_STYLE === "basic" ? "basic" : "motion-skill");

/** The ready skill, waiting while it's still being written; null if it fails, never started, or isn't ready in time. */
async function readySkill(a: ReadyArtifact, o: RenderOptions): Promise<SkillCard | null> {
  if (!o.skillCard) return null;
  const until = Date.now() + (o.skillWaitMs ?? 180_000);
  for (;;) {
    const s = await o.skillCard(a).catch(() => ({ status: "failed" as const, card: null }));
    if (s.status === "ready" || s.status === "failed" || s.status === "none" || Date.now() >= until) return s.card;
    await new Promise((r) => setTimeout(r, 10_000));
  }
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
    const cues = captionCues(draft.map((s) => s.narration_text), slots, 32);
    await writeFile(vtt, toVtt(cues));
    const motion = renderStyle() === "motion-skill";
    const skill = motion ? await readySkill(a, o) : null;
    let out: { mp4: string; narration: string; duration: number };
    if (motion) {
      const track = await narrationTrack(dir, wavs, slots);
      const film = await renderMotion(dir, motionSpec(a, draft, slots, skill), track.wav);
      out = { mp4: film.mp4, narration: track.m4a, duration: film.duration };
    } else {
      out = await composeShort({ dir, narration: wavs, onScreen: draft.map((s) => s.on_screen_text), slots, category: a.category });
    }

    const scenes: ScriptScene[] = draft.map((s, i) => ({
      start_seconds: slots[i].start, end_seconds: slots[i].end,
      narration_text: s.narration_text, on_screen_text: s.on_screen_text, visual_instruction: s.visual_instruction, source_ids: s.source_ids,
    }));
    out.mp4 = await burnSubtitles(dir, out.mp4, cues);
    const judgment = await judgeShort(a, scenes, out.mp4, dir, { apiKey: o.openaiKey, model: o.openaiModel, fetchImpl: o.fetchImpl }, skill);

    const base = `${a.id}/${a.version}`;
    const media_ref = await o.media.put(`videos/${base}/short.mp4`, out.mp4, "video/mp4");
    const caption_ref = await o.media.put(`captions/${base}/short.vtt`, vtt, "text/vtt; charset=utf-8");
    const narration_ref = await o.media.put(`audio/${base}/narration.m4a`, out.narration, "audio/mp4");

    return {
      judgment,
      script: { scenes },
      // The model and reasoning effort that wrote the script, so a render shows how it was made.
      prompt_revision: `${SCRIPT_PROMPT_REVISION}; openai:${o.openaiModel ?? DEFAULT_DIGEST_MODEL}${reasoningEffort() ? `/${reasoningEffort()}` : ""}; tts:${o.ttsModel ?? TTS_MODEL}${motion ? `; ${MOTION_SKILL_REVISION}` : ""}`,
      media_ref, caption_ref, narration_ref, duration_seconds: out.duration,
      music_provenance: motion ? MOTION_MUSIC_PROVENANCE : null,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
