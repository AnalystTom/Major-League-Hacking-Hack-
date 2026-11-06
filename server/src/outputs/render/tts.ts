// Narration with Gemini TTS through the Interactions API. A unary reply is base64 WAV (16-bit PCM, mono, 24 kHz).

import { httpError } from "../../httpError.js";
import { geminiUsage, recordUsage } from "../../usage.js";

export const TTS_MODEL = "gemini-3.8-flash-tts";
export const TTS_VOICE = "Kore";
const STYLE = "clear, warm explainer for engineers, brisk but unhurried";

export interface TtsOptions {
  apiKey: string;
  model?: string;
  voice?: string;
  fetchImpl?: typeof fetch;
  retries?: number;
  /** Workers AI through the processor Worker, used once Gemini is out of quota; defaults to D1_URL/D1_TOKEN. */
  fallback?: TtsFallback | null;
}

/** The processor Worker's /internal/tts bridge, which holds the Workers AI binding (deploy/processor/src/tts.js). */
export interface TtsFallback { url: string; token: string }
export const FALLBACK_TTS_MODEL = "workers-ai:@cf/deepgram/aura-2-en";
export const ttsFallbackFromEnv = (env: NodeJS.ProcessEnv = process.env): TtsFallback | null =>
  env.D1_URL && env.D1_TOKEN ? { url: new URL("/internal/tts", env.D1_URL).href, token: env.D1_TOKEN } : null;

// After a Gemini quota error, narrate with the fallback for an hour instead of spending retries on more 429s.
const QUOTA_PAUSE_MS = 3_600_000;
let geminiPausedUntil = 0;
/** The voice the next narration uses: the Gemini model, or the fallback while Gemini is paused for quota. */
export const narrationVoice = (model?: string, fallback = ttsFallbackFromEnv()) =>
  fallback && Date.now() < geminiPausedUntil ? FALLBACK_TTS_MODEL : model ?? TTS_MODEL;
/** Test hook: forget a quota pause. */
export const resetTtsQuotaPause = () => { geminiPausedUntil = 0; };

async function speakWithFallback(text: string, f: TtsFallback, fetchImpl: typeof fetch): Promise<Buffer> {
  const res = await fetchImpl(f.url, {
    method: "POST", headers: { authorization: `Bearer ${f.token}`, "content-type": "application/json" },
    body: JSON.stringify({ text }), signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(httpError("Fallback TTS", res.status, await res.text()));
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0, 4).toString("ascii") !== "RIFF") throw new Error("Fallback TTS returned no WAV audio");
  recordUsage({ step: "tts", provider: "workers-ai", model: FALLBACK_TTS_MODEL, input_tokens: null, output_tokens: null, reasoning_tokens: null, ref: `${text.length} chars` });
  return bytes;
}

/** Wraps headerless 16-bit mono PCM in a WAV header, for replies that come back as raw audio/l16. */
export function pcmToWav(pcm: Buffer, sampleRate = 24_000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function audioFrom(body: any): string | undefined {
  const steps: any[] = Array.isArray(body?.steps) ? body.steps : [];
  const parts = steps.filter((s) => s?.type === "model_output").flatMap((s) => (Array.isArray(s.content) ? s.content : []));
  return parts.filter((p) => p?.type === "audio" && typeof p.data === "string").at(-1)?.data ?? body?.output_audio?.data;
}

/** Speaks one passage and returns WAV bytes, or throws with the actual failure. Retries 429/5xx. */
export async function synthesize(text: string, o: TtsOptions): Promise<Buffer> {
  const f = o.fetchImpl ?? fetch;
  const fallback = o.fallback === undefined ? ttsFallbackFromEnv() : o.fallback;
  if (fallback && Date.now() < geminiPausedUntil) return speakWithFallback(text, fallback, f);
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= (o.retries ?? 2); attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
    let res: Response;
    try {
      res = await f("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": o.apiKey },
        body: JSON.stringify({
          model: o.model ?? TTS_MODEL,
          input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: STYLE }] }] }],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice: o.voice ?? TTS_VOICE }] },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      lastError = `TTS request failed: ${(e as Error).message}`;
      continue;
    }
    const raw = await res.text();
    if (res.status === 429 && fallback) {
      geminiPausedUntil = Date.now() + QUOTA_PAUSE_MS;
      return speakWithFallback(text, fallback, f);
    }
    if (res.status === 429 || res.status >= 500) { lastError = httpError("TTS", res.status, raw); continue; }
    if (!res.ok) throw new Error(httpError("TTS", res.status, raw));
    const body = JSON.parse(raw);
    recordUsage({ step: "tts", provider: "gemini", model: o.model ?? TTS_MODEL, ...geminiUsage(body), ref: `${text.length} chars` });
    const data = audioFrom(body);
    if (!data) throw new Error("TTS returned no audio");
    const bytes = Buffer.from(data, "base64");
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" ? bytes : pcmToWav(bytes);
  }
  throw new Error(lastError);
}
