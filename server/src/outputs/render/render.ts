// Workflow 2: script -> narration per scene -> measured timeline -> captions -> video -> R2.
// The picture is drawn with motion-graphic-skill (motion-skill.ts) unless RENDER_STYLE=basic, which keeps the plain
// ffmpeg text cards; both use the same script, narration and captions.

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertJudged, judgeShort, publicationJudgment, QualityRejected } from "./judge.js";
import { burnSubtitles, composeShort, probe } from "./ffmpeg.js";
import type { MediaStore } from "./media.js";
import { SCRIPT_PROMPT_REVISION, scriptEffort, shortModel, writeScript, reviseScript, type DraftScene } from "./script.js";
import { captionCues, timeline, toVtt } from "./timeline.js";
import { synthesize, TTS_MODEL } from "./tts.js";
import { MOTION_MUSIC_PROVENANCE, MOTION_SKILL_REVISION, cueCheck, motionSpec, narrationTrack, renderMotion, type SkillCard } from "./motion-skill.js";
import type { SkillState } from "../store.js";
import type { ProviderOptions, ReadyArtifact, RenderedVideo, ReviewFix, ScriptScene, ShortReview } from "../types.js";

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

async function renderRound(a: ReadyArtifact, draft: DraftScene[], dir: string, round: number, o: RenderOptions, skill: SkillCard | null, cue_checks: string[]) {
  await mkdir(dir, { recursive: true });
  const wavs: string[] = [];
  for (const [i, scene] of draft.entries()) {
    const wav = join(dir, `scene-${i}.wav`);
    await writeFile(wav, await synthesize(scene.narration_text, { apiKey: o.geminiKey, model: o.ttsModel, voice: o.ttsVoice, fetchImpl: o.fetchImpl }));
    wavs.push(wav);
  }
  const slots = timeline(await Promise.all(wavs.map(async wav => (await probe(wav)).duration)));
  const cues = captionCues(draft.map(scene => scene.narration_text), slots, 32);
  const vtt = join(dir, "short.vtt");
  await writeFile(vtt, toVtt(cues));
  let verification: unknown = null;
  let out: { mp4: string; narration: string; duration: number };
  const spec = renderStyle() === "motion-skill" ? motionSpec(a, draft, slots, skill) : null;
  const cue_check = spec ? await cueCheck(spec, round) :
    [`Round ${round}`, ...slots.map((_, i) => `Scene ${i}: no cues; narration only; no motion sound cue to synchronize. PASS`), "impact cues: 0 PASS"].join("\n");
  cue_checks.push(cue_check);
  await mkdir(join(dir, "motion-check"), { recursive: true });
  await writeFile(join(dir, "motion-check", "cue-check.md"), cue_check);
  if (spec) {
    const track = await narrationTrack(dir, wavs, slots);
    const film = await renderMotion(dir, spec, track.wav);
    verification = film.verification;
    out = { mp4: film.mp4, narration: track.m4a, duration: film.duration };
  } else {
    out = await composeShort({ dir, narration: wavs, onScreen: draft.map(scene => scene.on_screen_text), slots, category: a.category });
  }
  const scenes: ScriptScene[] = draft.map((scene, i) => ({
    start_seconds: slots[i].start, end_seconds: slots[i].end, narration_text: scene.narration_text,
    on_screen_text: scene.on_screen_text, visual_instruction: scene.visual_instruction, source_ids: scene.source_ids,
  }));
  out.mp4 = await burnSubtitles(dir, out.mp4, cues);
  const review = await judgeShort(a, scenes, out.mp4, dir,
    { apiKey: o.openaiKey, model: o.openaiModel, fetchImpl: o.fetchImpl }, skill, verification, cue_check, round);
  return { out, scenes, vtt, review };
}

export async function renderArtifact(a: ReadyArtifact, o: RenderOptions): Promise<RenderedVideo> {
  const model = { apiKey: o.openaiKey, model: o.openaiModel, fetchImpl: o.fetchImpl };
  const draft = await writeScript(a, model);
  const dir = await mkdtemp(join(tmpdir(), "resurface-render-"));
  const reviews: ShortReview[] = [], cue_checks: string[] = [];
  let fixes: ReviewFix[] = [];
  try {
    const motion = renderStyle() === "motion-skill";
    const skill = motion ? await readySkill(a, o) : null;
    const first = await renderRound(a, draft, join(dir, "round-1"), 1, o, skill, cue_checks);
    reviews.push(first.review);
    const revised = await reviseScript(a, draft, first.review, model);
    fixes = revised.fixes;
    const second = await renderRound(a, revised.scenes, join(dir, "round-2"), 2, o, skill, cue_checks);
    reviews.push(second.review);
    const judgment = publicationJudgment(reviews, fixes, cue_checks);
    await writeFile(join(dir, "review_log.md"), judgment.review_log);
    if (!judgment.passed) throw new QualityRejected(judgment);
    assertJudged(judgment);
    const base = `${a.id}/${a.version}/${randomUUID()}`;
    const media_ref = await o.media.put(`videos/${base}/short.mp4`, second.out.mp4, "video/mp4");
    const caption_ref = await o.media.put(`captions/${base}/short.vtt`, second.vtt, "text/vtt; charset=utf-8");
    const narration_ref = await o.media.put(`audio/${base}/narration.m4a`, second.out.narration, "audio/mp4");
    return {
      judgment, script: { scenes: second.scenes },
      prompt_revision: `${SCRIPT_PROMPT_REVISION}; openai:${shortModel(o.openaiModel)}/${scriptEffort()}; tts:${o.ttsModel ?? TTS_MODEL}${motion ? `; ${MOTION_SKILL_REVISION}` : ""}`,
      media_ref, caption_ref, narration_ref, duration_seconds: second.out.duration,
      music_provenance: motion ? MOTION_MUSIC_PROVENANCE : null,
    };
  } catch (error) {
    if (reviews.length && error instanceof Error && !(error instanceof QualityRejected)) {
      Object.assign(error, { judgment: publicationJudgment(reviews, fixes, cue_checks) });
    }
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
