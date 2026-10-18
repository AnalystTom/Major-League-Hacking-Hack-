// The processing service from the spec's "Processor contract": claim pending units, extract them, then digest
// ready units. Extraction and digests are shared: a video imported twice is read and digested once.

import { digestAndStore, extractUnit, type IngestOptions } from "./pipeline.js";
import { recordError } from "../activity.js";
import { DEFAULT_CATEGORIZATION_REQUEST, promptRevisionText } from "./digest/prompt.js";
import type { IngestedUnit, StoredArtifact } from "./types.js";
import { tracked } from "../activity.js";
import { UNLIMITED, type Limits } from "./limits.js";

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
  /** New units allowed per UTC day and month; unlimited when absent (src/index.ts applies the defaults). */
  limits?: Limits;
  /** Called with each new ready artifact set, without waiting: the skill and short are made from these. */
  onArtifacts?: (artifacts: StoredArtifact[]) => Promise<void>;
}

export interface ProcessSummary {
  extracted: { ready: number; failed: number };
  /** Units some other worker was already extracting that we waited for. */
  waitedFor: number;
  /** Units left pending because the processing limit is used up. */
  deferred: number;
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
export function processUnits(unitIds: string[], o: ProcessorOptions): Promise<ProcessSummary> {
  return tracked(() => processNow(unitIds, o));
}

async function processNow(unitIds: string[], o: ProcessorOptions): Promise<ProcessSummary> {
  const summary: ProcessSummary = { extracted: { ready: 0, failed: 0 }, waitedFor: 0, deferred: 0, digested: 0, skipped: null };

  const { claimed, deferred, resumesAt } = await o.store.claimWithinLimits(unitIds, o.limits ?? UNLIMITED);
  summary.deferred = deferred.length;
  if (deferred.length) o.log?.(`processing limit reached: ${deferred.length} unit(s) wait until ${resumesAt?.toISOString()}`);
  const extracted = await Promise.all(claimed.map((u) => extractUnit(u, o)));
  summary.extracted.ready = extracted.filter((u) => u.status === "ready").length;
  summary.extracted.failed = extracted.filter((u) => u.status === "failed").length;

  // Units another worker (the sweep, a duplicate request) is still extracting settle before we digest.
  const claimedIds = new Set(claimed.map((u) => u.id));
  // Deferred units won't move until the limit allows, so nothing waits for them.
  const held = new Set(deferred);
  const others = unitIds.filter((id) => !claimedIds.has(id) && !held.has(id));
  const units = others.length ? [...extracted, ...(await waitForSettled(others, o))] : extracted;
  summary.waitedFor = units.length - extracted.length;

  if (!o.openaiKey) { summary.skipped = "NICRRON_API_KEY not configured"; return summary; }

  const readyIds = units.filter((u) => u.status === "ready").map((u) => u.id);
  // Taken as in flight in the same tick as the check, before any await, so a concurrent request can't digest them too.
  const candidates = (await o.store.unitsNeedingDigest(readyIds)).filter((id) => !inFlight.has(id));
  candidates.forEach((id) => inFlight.add(id));
  let needing: string[] = [];
  try {
    // A digest spends money too, so one that its extraction didn't already pay for needs room under the limits.
    const reserved = await o.store.reserveDigests(candidates, o.limits ?? UNLIMITED);
    if (reserved.deferred.length) {
      summary.deferred += reserved.deferred.length;
      o.log?.(`processing limit reached: ${reserved.deferred.length} digest(s) wait until ${reserved.resumesAt?.toISOString()}`);
    }
    needing = reserved.allowed;
    if (needing.length === 0) { summary.skipped = reserved.deferred.length ? "processing limit reached" : "nothing new to digest"; return summary; }

    const request = o.categorizationRequest ?? DEFAULT_CATEGORIZATION_REQUEST;
    const toDigest = units.filter((u) => needing.includes(u.id));
    try {
      const d = await digestAndStore({ apiKey: o.openaiKey, model: o.openaiModel, maxOutputTokens: o.openaiMaxOutputTokens, units: toDigest, request, fetchImpl: o.fetchImpl, store: o.store });
      if (d.storeError) throw new Error(`could not store digest: ${d.storeError}`);
      summary.digested = d.stored?.length ?? 0;
      // A video the digest neither used nor excluded would otherwise be retried forever; record that plainly.
      const used = new Set([...d.result.artifacts.flatMap((a) => a.source_ids), ...d.result.exclusions.map((e) => e.unit_id)]);
      const unaccounted = needing.filter((id) => !used.has(id));
      if (unaccounted.length && d.promptId) {
        await o.store.saveArtifacts([], unaccounted.map((unit_id) => ({ unit_id, reason: "The Digestion Prompt didn't use this video and gave no reason." })), d.promptId);
      }
      const ready = (d.stored ?? []).filter((a) => a.ingestion_status === "ready");
      if (ready.length && o.onArtifacts) o.onArtifacts(ready).catch((e: Error) => o.log?.(`outputs failed: ${e.message}`));
    } catch (e) {
      const promptId = await o.store.registerPrompt(promptRevisionText(request), []).catch(() => null);
      await o.store.saveFailedArtifacts(needing, (e as Error).message, promptId);
      recordError("digest failed", e);
      o.log?.(`digest failed for ${needing.length} unit(s): ${(e as Error).message}`);
    }
  } finally {
    candidates.forEach((id) => inFlight.delete(id));
  }
  return summary;
}

/**
 * One sweep: pending units that someone imported and no request picked up (or whose processor died), and ready
 * units someone imported but can't see a digest of yet (never digested, failed up to MAX_DIGEST_ATTEMPTS, or only
 * digested together with videos they didn't import).
 */
export async function sweepOnce(o: ProcessorOptions, limit = 20): Promise<number> {
  // One batch per person: a digest can combine videos, and it must only combine one person's.
  const groups = new Map<string, Set<string>>();
  const add = (user: string | null | undefined, id: string) => (groups.get(user ?? "") ?? groups.set(user ?? "", new Set()).get(user ?? "")!).add(id);
  const pending = await o.store.listPendingUnitIds(limit);
  const owners = await o.store.newestImporters(pending);
  for (const id of pending) add(owners.get(id), id);
  if (o.openaiKey) for (const { unitId, userId } of await o.store.listUnitsNeedingDigest(limit)) add(userId, unitId);
  let n = 0;
  for (const ids of groups.values()) {
    n += ids.size;
    await processUnits([...ids], o);
  }
  return n;
}

/** Runs sweepOnce on a timer (skipping a tick while one is still running). Returns a stop function. */
export function startSweep(o: ProcessorOptions, intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await sweepOnce(o);
      if (n) o.log?.(`sweep processed ${n} pending unit(s)`);
    } catch (e) {
      recordError("sweep failed", e);
      o.log?.(`sweep failed: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };
  // A host that wakes this process on a schedule gets a sweep right away, not one interval later.
  const first = setTimeout(tick, 1000);
  const timer = setInterval(tick, intervalMs);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
