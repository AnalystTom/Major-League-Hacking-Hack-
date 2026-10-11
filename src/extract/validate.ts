import type { EvidenceItem, IngestedUnit, ModelExtraction } from "../types.ts";

/** Compare ids, so www/short-link spellings of the same video match. */
function videoIdOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v");
  } catch {
    return null;
  }
}

export interface ValidationResult {
  ok: boolean;
  error: string | null;
  accepted: EvidenceItem[];
  rejected: { item: EvidenceItem; reason: string }[];
}

/**
 * Request-derived identity and window always win over model-reported ones:
 * wrong identity -> reject all; out-of-window items -> drop; no surviving item -> not ready.
 */
export function validateExtraction(
  extraction: ModelExtraction,
  request: { sourceUrl: string; window: [number, number] },
): ValidationResult {
  const [lo, hi] = request.window;
  const reqId = videoIdOf(request.sourceUrl);
  if (videoIdOf(extraction.source_url) !== reqId) {
    return { ok: false, error: `model reported a different source (${extraction.source_url})`, accepted: [], rejected: [] };
  }
  if (!extraction.content_accessed) {
    return { ok: false, error: "model reported it did not access video content", accepted: [], rejected: [] };
  }
  const accepted: EvidenceItem[] = [];
  const rejected: ValidationResult["rejected"] = [];
  for (const item of extraction.evidence_items) {
    if (item.end_seconds < item.start_seconds) rejected.push({ item, reason: "end before start" });
    else if (item.start_seconds < lo || item.end_seconds > hi) rejected.push({ item, reason: `outside requested window ${lo}-${hi}s` });
    else if (!item.observed_spoken_content.trim()) rejected.push({ item, reason: "empty spoken content" });
    else accepted.push(item);
  }
  if (accepted.length === 0) return { ok: false, error: "no valid evidence items within the requested window", accepted, rejected };
  return { ok: true, error: null, accepted, rejected };
}

export function applyValidation(
  unit: IngestedUnit,
  result: ValidationResult,
  extraction: ModelExtraction | null,
  window: [number, number],
): IngestedUnit {
  return {
    ...unit,
    status: result.ok ? "ready" : "failed",
    error: result.error,
    transcript: result.ok ? { overview: extraction?.overview, window, evidence_items: result.accepted } : null,
    rejectedItems: result.rejected,
    extractedAt: new Date(),
  };
}
