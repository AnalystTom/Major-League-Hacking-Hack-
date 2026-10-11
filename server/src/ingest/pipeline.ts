import { randomUUID } from "node:crypto";
import { isXUrl, parseXPostUrl, parseYouTubeUrl } from "./urls.js";
import { extractXPost, X_POST_METHOD } from "./extract/xpost.js";
import { extractWithGemini, windowFor, GEMINI_MODEL } from "./extract/gemini.js";
import { applyValidation, validateExtraction } from "./extract/validate.js";
import { fetchTitle } from "./extract/title.js";
import { runDigestion, type DigestOptions } from "./digest/run.js";
import { promptRevisionText } from "./digest/prompt.js";
import type { Store } from "./store.js";
import type { IngestedUnit, StoredArtifact } from "./types.js";

export interface IngestOptions {
  geminiKey: string;
  /** twitterapi.io key; without it X posts fail with a clear error instead of being skipped. */
  twitterApiKey?: string;
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
  if (unit.contentType === "x_post") return extractXPostUnit(unit, o);
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
  await o.store.saveUnit(out);
  return out;
}

/** X posts are read from twitterapi.io as text; no model is involved in extraction. */
async function extractXPostUnit(unit: IngestedUnit, o: IngestOptions): Promise<IngestedUnit> {
  let out: IngestedUnit = { ...unit, extractionMethod: X_POST_METHOD, extractedAt: new Date() };
  try {
    if (!o.twitterApiKey) throw new Error("TWITTERAPI_IO_KEY is not configured");
    const postId = /\/status\/(\d+)$/.exec(unit.sourceUrl)?.[1];
    if (!postId) throw new Error("stored source_url is not an X post");
    const { title, transcript } = await extractXPost({ apiKey: o.twitterApiKey, postId, fetchImpl: o.fetchImpl });
    out = { ...out, title, transcript, status: "ready", error: null, rejectedItems: [] };
  } catch (e) {
    out = { ...out, status: "failed", error: (e as Error).message };
  }
  await o.store.saveUnit(out);
  return out;
}

/** Import one submitted link (dev route/CLI). Returns a unit with its actual status/error; never throws for per-link failures. */
export async function ingestLink(link: string, o: IngestOptions, onUpdate?: (u: IngestedUnit) => void): Promise<IngestedUnit> {
  const base: IngestedUnit = {
    id: randomUUID(), submittedUrl: link, sourceUrl: link, startSeconds: null, title: null, transcript: null,
    extractionMethod: null, extractedAt: null, status: "pending", error: null,
  };
  if (isXUrl(link)) {
    let x;
    try {
      x = parseXPostUrl(link);
    } catch (e) {
      const failed: IngestedUnit = { ...base, contentType: "x_post", status: "failed", error: (e as Error).message, extractedAt: new Date() };
      await o.store.saveUnit(failed);
      return failed;
    }
    const unit: IngestedUnit = { ...base, contentType: "x_post", sourceUrl: x.sourceUrl, status: "running" };
    await o.store.saveUnit(unit);
    onUpdate?.(unit);
    return extractUnit(unit, o);
  }
  let p;
  try {
    p = parseYouTubeUrl(link);
  } catch (e) {
    const failed: IngestedUnit = { ...base, status: "failed", error: (e as Error).message, extractedAt: new Date() };
    await o.store.saveUnit(failed);
    return failed;
  }
  const unit: IngestedUnit = { ...base, sourceUrl: p.sourceUrl, startSeconds: p.startSeconds, status: "running" };
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
