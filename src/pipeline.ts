import { randomUUID } from "node:crypto";
import { parseYouTubeUrl } from "./urls.ts";
import { extractWithGemini, windowFor, GEMINI_MODEL } from "./extract/gemini.ts";
import { applyValidation, validateExtraction } from "./extract/validate.ts";
import type { Store } from "./store.ts";
import type { IngestedUnit } from "./types.ts";

export interface IngestOptions {
  geminiKey: string;
  store: Store;
  windowSeconds?: number;
  fetchImpl?: typeof fetch;
  retries?: number;
}

/** Import one submitted link. Always returns a unit with its actual status/error; never throws for per-link failures. */
export async function ingestLink(link: string, o: IngestOptions, onUpdate?: (u: IngestedUnit) => void): Promise<IngestedUnit> {
  const base: IngestedUnit = {
    id: randomUUID(), submittedUrl: link, sourceUrl: link, startSeconds: null, title: null, transcript: null,
    extractionMethod: `gemini:${GEMINI_MODEL}`, extractedAt: null, status: "pending", error: null,
  };
  let unit = base;
  try {
    const p = parseYouTubeUrl(link);
    unit = { ...base, sourceUrl: p.sourceUrl, startSeconds: p.startSeconds, status: "running" };
    await o.store.saveUnit(unit);
    onUpdate?.(unit);
    const window = windowFor(p.startSeconds, o.windowSeconds);
    const { extraction } = await extractWithGemini({ apiKey: o.geminiKey, sourceUrl: p.sourceUrl, window, fetchImpl: o.fetchImpl, retries: o.retries });
    unit = applyValidation(unit, validateExtraction(extraction, { sourceUrl: p.sourceUrl, window }), extraction, window);
  } catch (e) {
    unit = { ...unit, status: "failed", error: (e as Error).message, extractedAt: new Date() };
  }
  await o.store.saveUnit(unit);
  return unit;
}

export async function ingestLinks(links: string[], o: IngestOptions): Promise<IngestedUnit[]> {
  return Promise.all(links.map((l) => ingestLink(l, o)));
}
