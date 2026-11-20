import { logFailure } from './log.js';

export const FALLBACK_MODEL = '@cf/deepgram/aura-2-en';
const MAX_CHARS = 2000;

export async function tts(request, env) {
  if (!env.AI) return Response.json({ error: 'Workers AI is not configured' }, { status: 503 });
  const { text } = await request.json().catch(() => ({}));
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_CHARS) return new Response('Invalid text', { status: 400 });
  try {
    const audio = await env.AI.run(FALLBACK_MODEL, { text, speaker: 'athena', encoding: 'linear16', container: 'wav', sample_rate: 24000 });
    return new Response(audio, { headers: { 'content-type': 'audio/wav' } });
  } catch (e) {
    logFailure('Workers AI TTS failed', e);
    return Response.json({ error: 'Workers AI TTS failed' }, { status: 502 });
  }
}
