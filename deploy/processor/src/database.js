// Kept outside the container: only this Worker has a D1 binding. The container holds a scoped bearer token.
export async function database(request, env) {
  if (!env.DB) return Response.json({ error: 'D1 is not configured' }, { status: 503 });
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return new Response('Send JSON', { status: 415 });
  const text = await request.text();
  if (text.length > 2_000_000) return new Response('Batch too large', { status: 413 });
  let statements;
  try { statements = JSON.parse(text).statements; } catch { return new Response('Invalid JSON', { status: 400 }); }
  if (!Array.isArray(statements) || !statements.length || statements.length > 500 || statements.some((s) =>
    typeof s?.sql !== 'string' || !s.sql.trim() || s.sql.length > 100_000 || !Array.isArray(s.params ?? []) || (s.params?.length ?? 0) > 100 ||
    (s.params ?? []).some((v) => v !== null && !['string','number'].includes(typeof v)))) {
    return new Response('Invalid statements', { status: 400 });
  }
  try {
    const results = await env.DB.batch(statements.map((s) => env.DB.prepare(s.sql).bind(...(s.params ?? []))));
    return Response.json({ results });
  } catch (e) {
    console.error('D1 batch failed', e.message);
    return Response.json({ error: 'D1 batch failed' }, { status: 500 });
  }
}
