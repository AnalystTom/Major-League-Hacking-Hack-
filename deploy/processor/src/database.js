import { logFailure } from './log.js';
import { ALLOWED_D1_STATEMENTS } from './d1-allowlist.js';

const validParams = (params) => Array.isArray(params) && params.length <= 100 &&
  params.every((v) => v === null || ['string', 'number'].includes(typeof v));

const validStatement = (s) => typeof s?.sql === 'string' && s.sql.trim() !== '' && s.sql.length <= 100_000 &&
  validParams(s.params ?? []);

export async function database(request, env) {
  if (!env.DB) return Response.json({ error: 'D1 is not configured' }, { status: 503 });
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return new Response('Send JSON', { status: 415 });
  const text = await request.text();
  if (text.length > 2_000_000) return new Response('Batch too large', { status: 413 });
  let statements;
  try { statements = JSON.parse(text).statements; } catch { return new Response('Invalid JSON', { status: 400 }); }
  if (!Array.isArray(statements) || !statements.length || statements.length > 500 || !statements.every(validStatement)) {
    return new Response('Invalid statements', { status: 400 });
  }
  if (!statements.every((s) => ALLOWED_D1_STATEMENTS.has(s.sql))) return new Response('Statement not allowed', { status: 403 });
  try {
    const results = await env.DB.batch(statements.map((s) => env.DB.prepare(s.sql).bind(...(s.params ?? []))));
    return Response.json({ results });
  } catch (e) {
    logFailure('D1 batch failed', e);
    return Response.json({ error: 'D1 batch failed' }, { status: 500 });
  }
}
