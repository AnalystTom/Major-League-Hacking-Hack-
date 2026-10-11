// The processing service from the spec's "Processor contract": claim pending units, extract them, then digest
// ready units. Extraction and digests are shared: a video imported twice is read and digested once.

import { digestAndStore, extractUnit, type IngestOptions } from "./pipeline.js";
import { DEFAULT_CATEGORIZATION_REQUEST, promptRevisionText } from "./digest/prompt.js";
import type { IngestedUnit } from "./types.js";

export interface ProcessorOptions extends IngestOptions {
  openaiKey?: string;
  openaiModel?: string;
  openaiMaxOutputTokens?: number;
  /** The categorization request for digests; DIGESTION_REQUEST or a built-in default. */
  categorizationRequest?: string;
  /** How long to wait for units another worker is extracting, and how often to check. */
  waitTimeoutMs?: number;
  pollMs?: number;
  log?: (msg: string) => void;
}

export interface ProcessSummary {
  extracted: { ready: number; failed: number };
  /** Units some other worker was already extracting that we waited for. */
  waitedFor: number;
  digested: number;
  skipped: string | null;
}

// Guards the same unit being digested twice in this process; another process is covered by the artifact check.
const inFlight = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const settled = (u: IngestedUnit) => u.status === "ready" || u.status === "failed";

async function waitForSettled(ids: string[], o: ProcessorOptions): Promise<IngestedUnit[]> {
  const deadline = Date.now() + (o.waitTimeoutMs ?? 10 * 60_000);
  for (;;) {
    const units = await o.store.getUnits(ids);
    if (units.every(settled) || Date.now() >= deadline) return units;
    await sleep(o.pollMs ?? 3000);
  }
}

/**
 * Processes units. Safe to call twice with the same ids: pending units are claimed atomically, ready units are
 * not re-extracted, and a unit that already has a digest (or was excluded) is skipped.
 */
export async function processUnits(unitIds: string[], o: ProcessorOptions): Promise<ProcessSummary> {
  const summary: ProcessSummary = { extracted: { ready: 0, failed: 0 }, waitedFor: 0, digested: 0, skipped: null };

  const claimed = await o.store.claimPendingUnits(unitIds);
  const extracted = await Promise.all(claimed.map((u) => extractUnit(u, o)));
  summary.extracted.ready = extracted.filter((u) => u.status === "ready").length;
  summary.extracted.failed = extracted.filter((u) => u.status === "failed").length;

  // Units another worker (the sweep, a duplicate request) is still extracting settle before we digest.
  const claimedIds = new Set(claimed.map((u) => u.id));
  const others = unitIds.filter((id) => !claimedIds.has(id));
  const units = others.length ? [...extracted, ...(await waitForSettled(others, o))] : extracted;
  summary.waitedFor = units.length - extracted.length;

  if (!o.openaiKey) { summary.skipped = "OPENAI_API_KEY not configured"; return summary; }

  const readyIds = units.filter((u) => u.status === "ready").map((u) => u.id);
  const needing = (await o.store.unitsNeedingDigest(readyIds)).filter((id) => !inFlight.has(id));
  if (needing.length === 0) { summary.skipped = "nothing new to digest"; return summary; }
  needing.forEach((id) => inFlight.add(id));
  try {
    const request = o.categorizationRequest ?? DEFAULT_CATEGORIZATION_REQUEST;
    const toDigest = units.filter((u) => needing.includes(u.id));
    try {
      const d = await digestAndStore({ apiKey: o.openaiKey, model: o.openaiModel, maxOutputTokens: o.openaiMaxOutputTokens, units: toDigest, request, fetchImpl: o.fetchImpl, store: o.store });
      if (d.storeError) throw new Error(`could not store digest: ${d.storeError}`);
      summary.digested = d.stored?.length ?? 0;
    } catch (e) {
      const promptId = await o.store.registerPrompt(promptRevisionText(request), []).catch(() => null);
      await o.store.saveFailedArtifacts(needing, (e as Error).message, promptId);
      o.log?.(`digest failed for ${needing.length} unit(s): ${(e as Error).message}`);
    }
  } finally {
    needing.forEach((id) => inFlight.delete(id));
  }
  return summary;
}

/** One sweep: pending units that someone imported and no request has picked up yet. */
export async function sweepOnce(o: ProcessorOptions, limit = 20): Promise<number> {
  const ids = await o.store.listPendingUnitIds(limit);
  if (ids.length) await processUnits(ids, o);
  return ids.length;
}

/** Runs sweepOnce on a timer (skipping a tick while one is still running). Returns a stop function. */
export function startSweep(o: ProcessorOptions, intervalMs = 60_000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const n = await sweepOnce(o);
      if (n) o.log?.(`sweep processed ${n} pending unit(s)`);
    } catch (e) {
      o.log?.(`sweep failed: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
