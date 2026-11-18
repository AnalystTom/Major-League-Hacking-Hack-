import { whileHeld } from "../claims.js";
import { generateSkill } from "./skills.js";
import { recordError } from "../activity.js";
import { renderArtifact } from "./render/render.js";
import { discardMedia, type MediaStore } from "./render/media.js";
import { LostClaim, type Kind, type OutputStore } from "./store.js";
import { tracked } from "../activity.js";
import { sourceRefs, type ProviderOptions, type ReadyArtifact, type ShortJudgment } from "./types.js";
import type { Limits } from "../ingest/limits.js";
import { isPermanentFailure } from "./retry.js";
import type { StoredArtifact } from "../ingest/types.js";

export interface OutputOptions extends ProviderOptions {
  outputs: OutputStore;
  limits?: Limits;
  media: MediaStore | null;
  shorts?: boolean;
  log?: (msg: string) => void;
}

interface ProducerState { inFlight: Set<string>; renderQueue: Promise<void> }
const states = new WeakMap<OutputOptions, ProducerState>();
function stateFor(o: OutputOptions): ProducerState {
  let s = states.get(o);
  if (!s) states.set(o, (s = { inFlight: new Set(), renderQueue: Promise.resolve() }));
  return s;
}

function produce(kind: Kind, a: ReadyArtifact, o: OutputOptions): Promise<void> {
  return tracked(() => produceNow(kind, a, o));
}

async function produceNow(kind: Kind, a: ReadyArtifact, o: OutputOptions) {
  const { inFlight } = stateFor(o);
  const key = `${kind}:${a.id}:${a.version}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const claim = await o.outputs.claim(kind, a, o.limits);
    if (!claim) return;
    const heartbeat = () => o.outputs.heartbeat(kind, claim);
    try {
      const { openaiKey, geminiKey, media } = o;
      if (!openaiKey) throw new Error("OPENAI_API_KEY isn't configured on the processor");
      if (kind === "skill") {
        const skill = await whileHeld(heartbeat, () => generateSkill(a, { apiKey: openaiKey, model: o.openaiModel, fetchImpl: o.fetchImpl }));
        await o.outputs.finishSkill(claim, skill);
      } else {
        if (!geminiKey) throw new Error("GEMINI_API_KEY isn't configured on the processor");
        if (!media) throw new Error("Media storage isn't configured on the processor (R2_*, MEDIA_LOCAL_WEB_DIR, or D1_URL with MEDIA_TOKEN set as the processor Worker secret MEDIA_UPLOAD_TOKEN)");
        const skillCard = o.outputs.skillCard?.bind(o.outputs);
        const video = await whileHeld(heartbeat, () => renderArtifact(a, { ...o, openaiKey, geminiKey, media, skillCard }));
        try {
          await o.outputs.finishVideo(claim, video);
        } catch (e) {
          if (e instanceof LostClaim) await discardMedia(media, [video.media_ref, video.caption_ref, video.narration_ref]);
          throw e;
        }
      }
      o.log?.(`${kind} ready for artifact ${a.id} v${a.version}`);
    } catch (e) {
      const error = e as Error & { judgment?: ShortJudgment };
      const recorded = !(e instanceof LostClaim) && (await o.outputs.fail(kind, claim, error.message, error.judgment, isPermanentFailure(error.message)));
      recordError(`${kind} failed`, e);
      o.log?.(`${kind} ${recorded ? "failed" : "not recorded"} for artifact ${a.id} v${a.version}: ${(e as Error).message}`);
    }
  } catch (e) {
    recordError(`${kind} claim failed`, e);
    o.log?.(`${kind} for artifact ${a.id} v${a.version} couldn't be claimed or recorded: ${(e as Error).message}`);
  } finally {
    inFlight.delete(key);
  }
}

async function queueRender(a: ReadyArtifact, o: OutputOptions): Promise<void> {
  if (o.shorts === false || !await o.outputs.videoRequested(a)) return;
  const state = stateFor(o);
  const job = tracked(() => state.renderQueue.then(() => produceNow("video", a, o)));
  state.renderQueue = job.catch(() => {});
  return job;
}

export async function produceOutputs(artifacts: ReadyArtifact[], o: OutputOptions): Promise<void> {
  await Promise.all([...artifacts.map((a) => produce("skill", a, o)), ...artifacts.map((a) => queueRender(a, o))]);
}

export async function sweepOutputs(o: OutputOptions, limit = 10): Promise<number> {
  const [skills, videos] = await Promise.all([o.outputs.artifactsNeeding("skill", limit), o.shorts === false ? [] : o.outputs.artifactsNeeding("video", limit)]);
  await Promise.all([
    ...skills.map((a) => produce("skill", a, o)),
    ...videos.map((a) => queueRender(a, o)),
  ]);
  return skills.length + videos.length;
}

export const toReadyArtifact = (a: StoredArtifact): ReadyArtifact => ({
  id: a.id, version: a.version, name: a.name, category: a.category || null, processed_text: a.processed_text,
  selection_reason: a.selection_reason || null, source_ids: a.source_ids,
  sources: sourceRefs(a.sources), evidence: a.evidence,
});

export function startOutputSweep(o: OutputOptions, intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await sweepOutputs(o);
      if (n) o.log?.(`output sweep handled ${n} artifact output(s)`);
    } catch (e) {
      recordError("output sweep failed", e);
      o.log?.(`output sweep failed: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 1000);
  const timer = setInterval(tick, intervalMs);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
