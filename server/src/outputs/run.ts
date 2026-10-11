// Runs both outputs for ready artifacts: skills right away, renders one at a time (they're CPU-heavy).
// Called after each digest and by the sweep, which also picks up claims a crashed processor left behind.

import { generateSkill } from "./skills.js";
import { renderArtifact } from "./render/render.js";
import type { MediaStore } from "./render/media.js";
import { LostClaim, type Kind, type OutputStore } from "./store.js";
import { sourceRefs, type ProviderOptions, type ReadyArtifact } from "./types.js";
import type { StoredArtifact } from "../ingest/types.js";

export interface OutputOptions extends ProviderOptions {
  outputs: OutputStore;
  /** Where rendered files go; without one, renders fail with that reason instead of waiting forever. */
  media: MediaStore | null;
  log?: (msg: string) => void;
}

// What's in flight and the render queue belong to one options object, so two processors in a process (or two
// tests) never share them. src/index.ts passes the same object to produceOutputs and the sweep.
interface ProducerState { inFlight: Set<string>; renderQueue: Promise<void> }
const states = new WeakMap<OutputOptions, ProducerState>();
function stateFor(o: OutputOptions): ProducerState {
  let s = states.get(o);
  if (!s) states.set(o, (s = { inFlight: new Set(), renderQueue: Promise.resolve() }));
  return s;
}

async function produce(kind: Kind, a: ReadyArtifact, o: OutputOptions) {
  const { inFlight } = stateFor(o);
  const key = `${kind}:${a.id}:${a.version}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const claim = await o.outputs.claim(kind, a);
    if (!claim) return;
    try {
      if (!o.openaiKey) throw new Error("OPENAI_API_KEY isn't configured on the processor");
      if (kind === "skill") {
        await o.outputs.finishSkill(claim, await generateSkill(a, { apiKey: o.openaiKey, model: o.openaiModel, fetchImpl: o.fetchImpl }));
      } else {
        if (!o.geminiKey) throw new Error("GEMINI_API_KEY isn't configured on the processor");
        if (!o.media) throw new Error("Media storage isn't configured on the processor (R2_* or MEDIA_LOCAL_WEB_DIR)");
        await o.outputs.finishVideo(claim, await renderArtifact(a, { ...o, openaiKey: o.openaiKey, geminiKey: o.geminiKey, media: o.media }));
      }
      o.log?.(`${kind} ready for artifact ${a.id} v${a.version}`);
    } catch (e) {
      // A worker whose claim was taken over leaves the row to the one that took it.
      const recorded = !(e instanceof LostClaim) && (await o.outputs.fail(kind, claim, (e as Error).message));
      o.log?.(`${kind} ${recorded ? "failed" : "not recorded"} for artifact ${a.id} v${a.version}: ${(e as Error).message}`);
    }
  } catch (e) {
    o.log?.(`${kind} for artifact ${a.id} v${a.version} couldn't be claimed or recorded: ${(e as Error).message}`);
  } finally {
    inFlight.delete(key);
  }
}

/** Renders run one after another; a job that fails doesn't stop the ones behind it. */
function queueRender(a: ReadyArtifact, o: OutputOptions): Promise<void> {
  const state = stateFor(o);
  const job = state.renderQueue.then(() => produce("video", a, o));
  state.renderQueue = job.catch(() => {});
  return job;
}

/** Produces the skill and the short for each artifact. Resolves when all of them have settled. */
export async function produceOutputs(artifacts: ReadyArtifact[], o: OutputOptions): Promise<void> {
  await Promise.all([...artifacts.map((a) => produce("skill", a, o)), ...artifacts.map((a) => queueRender(a, o))]);
}

/** Finds ready artifacts still missing a skill or a short and produces them. Returns how many it started. */
export async function sweepOutputs(o: OutputOptions, limit = 10): Promise<number> {
  const [skills, videos] = await Promise.all([o.outputs.artifactsNeeding("skill", limit), o.outputs.artifactsNeeding("video", limit)]);
  await Promise.all([
    ...skills.map((a) => produce("skill", a, o)),
    ...videos.map((a) => queueRender(a, o)),
  ]);
  return skills.length + videos.length;
}

/** The digest's stored artifact in the shape the outputs read. */
export const toReadyArtifact = (a: StoredArtifact): ReadyArtifact => ({
  id: a.id, version: a.version, name: a.name, category: a.category || null, processed_text: a.processed_text,
  selection_reason: a.selection_reason || null, source_ids: a.source_ids,
  sources: sourceRefs(a.sources), evidence: a.evidence,
});

/** Runs sweepOutputs on a timer, skipping a tick while one is still running. Returns a stop function. */
export function startOutputSweep(o: OutputOptions, intervalMs = 60_000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const n = await sweepOutputs(o);
      if (n) o.log?.(`output sweep handled ${n} artifact output(s)`);
    } catch (e) {
      o.log?.(`output sweep failed: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
