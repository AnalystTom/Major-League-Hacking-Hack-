// Kept outside the container: only this Worker has the R2 binding. The container PUTs each rendered file here with its bearer token.
const KEY = /^(videos|captions|audio)\/[\w-]+\/\d+\/[\w.-]+$/;
const MAX_BYTES = 50_000_000;

export async function media(request, env) {
  if (!env.MEDIA) return Response.json({ error: 'R2 is not configured' }, { status: 503 });
  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (!KEY.test(key)) return new Response('Invalid key', { status: 400 });
  const size = Number(request.headers.get('content-length'));
  if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES) return new Response('Invalid size', { status: 413 });
  try {
    await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: request.headers.get('content-type') ?? 'application/octet-stream' } });
    return Response.json({ size: (await env.MEDIA.head(key))?.size ?? 0 });
  } catch (e) {
    console.error('R2 put failed', e.message);
    return Response.json({ error: 'R2 put failed' }, { status: 500 });
  }
}
