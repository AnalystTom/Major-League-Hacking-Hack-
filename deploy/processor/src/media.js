const KEY = /^(videos|captions|audio)\/[\w-]+\/\d+\/(?:[\w-]+\/)?[\w.-]+$/;
const MAX_BYTES = 50_000_000;
const CONTENT_TYPES = new Map([['mp4', 'video/mp4'], ['vtt', 'text/vtt; charset=utf-8'], ['m4a', 'audio/mp4']]);

export async function media(request, env) {
  if (!env.MEDIA) return Response.json({ error: 'R2 is not configured' }, { status: 503 });
  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (!KEY.test(key)) return new Response('Invalid key', { status: 400 });
  if (request.method === 'DELETE') {
    try {
      await env.MEDIA.delete(key);
      return Response.json({ deleted: true });
    } catch (e) {
      console.error('R2 delete failed', e.message);
      return Response.json({ error: 'R2 delete failed' }, { status: 500 });
    }
  }
  const contentType = CONTENT_TYPES.get(key.slice(key.lastIndexOf('.') + 1));
  if (!contentType) return new Response('Content type not allowed', { status: 415 });
  const size = Number(request.headers.get('content-length'));
  if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES) return new Response('Invalid size', { status: 413 });
  try {
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType } });
    return Response.json({ size: (await env.MEDIA.head(key))?.size ?? 0 });
  } catch (e) {
    console.error('R2 put failed', e.message);
    return Response.json({ error: 'R2 put failed' }, { status: 500 });
  }
}
