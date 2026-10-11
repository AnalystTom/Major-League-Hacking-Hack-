// Narration with Gemini TTS through the Interactions API. A unary reply is base64 WAV (16-bit PCM, mono, 24 kHz).

import { httpError } from "../../httpError.js";

export const TTS_MODEL = "gemini-3.8-flash-tts";
export const TTS_VOICE = "Kore";
const STYLE = "clear, warm explainer for engineers, brisk but unhurried";

export interface TtsOptions {
  apiKey: string;
  model?: string;
  voice?: string;
  fetchImpl?: typeof fetch;
  retries?: number;
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
    if (res.status === 429 || res.status >= 500) { lastError = httpError("TTS", res.status, raw); continue; }
    if (!res.ok) throw new Error(httpError("TTS", res.status, raw));
    const data = audioFrom(JSON.parse(raw));
    if (!data) throw new Error("TTS returned no audio");
    const bytes = Buffer.from(data, "base64");
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" ? bytes : pcmToWav(bytes);
  }
  throw new Error(lastError);
}
