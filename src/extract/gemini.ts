import { ModelExtraction } from "../types.ts";

export const GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_WINDOW_SECONDS = 300;

export const EXTRACTION_PROMPT = `You are extracting evidence from a YouTube video segment for an AI engineer.
Report only what is actually said or shown inside the provided segment. Do not guess. Do not quote verbatim; paraphrase speech.
Return JSON: {"source_url": string, "content_accessed": boolean, "overview": string,
"evidence_items": [{"start_seconds": int, "end_seconds": int, "observed_spoken_content": string,
"observed_visual_content": string, "technique": string}]}.
Timestamps are absolute seconds in the full video. Prefer concrete, actionable engineering techniques, workflows or claims
over descriptions of presentation style. Set content_accessed=false if you cannot see/hear the segment.`;

export interface GeminiRequestOptions {
  apiKey: string;
  sourceUrl: string;
  window: [number, number];
  fetchImpl?: typeof fetch;
  retries?: number;
  timeoutMs?: number;
}

export function windowFor(startSeconds: number | null, length = DEFAULT_WINDOW_SECONDS): [number, number] {
  const start = startSeconds ?? 0;
  return [start, start + length];
}

export function buildRequestBody(sourceUrl: string, window: [number, number]) {
  return {
    contents: [{
      parts: [
        { fileData: { fileUri: sourceUrl }, videoMetadata: { startOffset: `${window[0]}s`, endOffset: `${window[1]}s` } },
        { text: EXTRACTION_PROMPT },
      ],
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 2000, responseMimeType: "application/json" },
  };
}

/** Calls Gemini and returns the parsed model output, or throws with the actual failure detail. Retries 429/5xx. */
export async function extractWithGemini(opts: GeminiRequestOptions): Promise<{ extraction: ModelExtraction; responseId: string | null }> {
  const f = opts.fetchImpl ?? fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const retries = opts.retries ?? 3;
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    let res: Response;
    try {
      res = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify(buildRequestBody(opts.sourceUrl, opts.window)),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      });
    } catch (e) {
      lastError = `request failed: ${(e as Error).message}`;
      continue;
    }
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) {
      lastError = `Gemini HTTP ${res.status}: ${text.slice(0, 300)}`;
      continue;
    }
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text);
    const out = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
    if (!out) throw new Error("Gemini returned no content");
    const parsed = ModelExtraction.safeParse(JSON.parse(out));
    if (!parsed.success) throw new Error(`Gemini output did not match the extraction shape: ${parsed.error.message.slice(0, 300)}`);
    return { extraction: parsed.data, responseId: body.responseId ?? null };
  }
  throw new Error(lastError);
}
