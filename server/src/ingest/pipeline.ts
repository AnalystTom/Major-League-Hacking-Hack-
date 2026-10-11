import { randomUUID } from "node:crypto";
import { parseSourceUrl } from "./urls.js";
import { extractWithNimble } from "./extract/nimble.js";
import { extractWithGemini, windowFor, GEMINI_MODEL } from "./extract/gemini.js";
import { applyValidation, validateExtraction } from "./extract/validate.js";
import { fetchTitle } from "./extract/title.js";
import { runDigestion, type DigestOptions } from "./digest/run.js";
import { promptRevisionText } from "./digest/prompt.js";
import type { Store } from "./store.js";
import type { IngestedUnit, StoredArtifact } from "./types.js";

export interface IngestOptions {
  geminiKey: string;
  /** Enables Substack post extraction; without it those units fail with a clear error. */
  nimbleKey?: string;
  store: Store;
  windowSeconds?: number;
  geminiModel?: string;
  fetchImpl?: typeof fetch;
  retries?: number;
}

/**
 * Extracts one existing unit (already claimed as running) from its stored source_url and start time.
 * Always saves and returns the unit with its actual status/error; never throws.
 */
export async function extractUnit(unit: IngestedUnit, o: IngestOptions): Promise<IngestedUnit> {
  const out = unit.contentType === "substack_post" ? await extractPost(unit, o) : await extractVideo(unit, o);
  await o.store.saveUnit(out);
  return out;
}

async function extractPost(unit: IngestedUnit, o: IngestOptions): Promise<IngestedUnit> {
  const out: IngestedUnit = { ...unit, extractionMethod: "nimble:markdown", extractedAt: new Date() };
  if (!o.nimbleKey) return { ...out, status: "failed", error: "NIMBLE_API_KEY not configured" };
  try {
    const r = await extractWithNimble({ apiKey: o.nimbleKey, sourceUrl: unit.sourceUrl, fetchImpl: o.fetchImpl, retries: o.retries });
    return { ...out, title: unit.title ?? r.title, transcript: r.transcript, status: "ready", error: null };
  } catch (e) {
    return { ...out, status: "failed", error: (e as Error).message };
  }
}

async function extractVideo(unit: IngestedUnit, o: IngestOptions): Promise<IngestedUnit> {
  let out: IngestedUnit = { ...unit, extractionMethod: `gemini:${o.geminiModel ?? GEMINI_MODEL}` };
  try {
    const window = windowFor(unit.startSeconds, o.windowSeconds);
    const [extracted, title] = await Promise.all([
      extractWithGemini({ apiKey: o.geminiKey, sourceUrl: unit.sourceUrl, window, model: o.geminiModel, fetchImpl: o.fetchImpl, retries: o.retries })
        .then((r) => ({ ok: true as const, ...r }), (e: Error) => ({ ok: false as const, error: e.message })),
      unit.title ? Promise.resolve(unit.title) : fetchTitle(unit.sourceUrl, o.fetchImpl),
    ]);
    out.title = title;
    if (!extracted.ok) out = { ...out, status: "failed", error: extracted.error, extractedAt: new Date() };
    else out = applyValidation(out, validateExtraction(extracted.extraction, { sourceUrl: unit.sourceUrl, window }), extracted.extraction, window);
  } catch (e) {
    out = { ...out, status: "failed", error: (e as Error).message, extractedAt: new Date() };
  }
  return out;
}

/** Import one submitted link (dev route/CLI). Returns a unit with its actual status/error; never throws for per-link failures. */
export async function ingestLink(link: string, o: IngestOptions, onUpdate?: (u: IngestedUnit) => void): Promise<IngestedUnit> {
  const base: IngestedUnit = {
    id: randomUUID(), submittedUrl: link, sourceUrl: link, startSeconds: null, title: null, contentType: "youtube_video", transcript: null,
    extractionMethod: null, extractedAt: null, status: "pending", error: null,
  };
  let p;
  try {
    p = parseSourceUrl(link);
  } catch (e) {
    const failed: IngestedUnit = { ...base, status: "failed", error: (e as Error).message, extractedAt: new Date() };
    await o.store.saveUnit(failed);
    return failed;
  }
  const unit: IngestedUnit = { ...base, sourceUrl: p.sourceUrl, startSeconds: p.startSeconds, contentType: p.contentType, status: "running" };
  await o.store.saveUnit(unit);
  onUpdate?.(unit);
  return extractUnit(unit, o);
}

export async function ingestLinks(links: string[], o: IngestOptions): Promise<IngestedUnit[]> {
  return Promise.all(links.map((l) => ingestLink(l, o)));
}

export interface DigestAndStoreOptions extends DigestOptions {
  store: Store;
}

/** Runs the Digestion Prompt, registers its revision, and stores artifacts and exclusions tied to that revision. */
export async function digestAndStore(o: DigestAndStoreOptions) {
  const result = await runDigestion(o);
  let promptId: string | null = null;
  let stored: StoredArtifact[] | null = null;
  let storeError: string | null = null;
  try {
    promptId = await o.store.registerPrompt(promptRevisionText(o.request), o.fewShot ?? []);
    stored = await o.store.saveArtifacts(result.artifacts, result.exclusions, promptId);
  } catch (e) {
    storeError = (e as Error).message;
  }
  return { result, promptId, stored, storeError };
}
