// The container reaches the processor Worker's D1 binding over its authenticated HTTP endpoint.
export interface Statement { sql: string; params?: unknown[] }
export interface QueryResult { rows: any[]; rowCount: number }
export interface Database {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  batch(statements: Statement[]): Promise<QueryResult[]>;
}

const JSON_COLUMNS = new Set(['facts', 'few_shot', 'transcript', 'source_ids', 'sources', 'evidence', 'script',
  'supporting_refs', 'applicability_evidence', 'prerequisites', 'steps', 'source_refs', 'payload', 'verification',
  'skill_result_ids', 'brief', 'prompts', 'action_items', 'unit_titles', 'unit_urls']);
export const decodeRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
  [key, JSON_COLUMNS.has(key) && typeof value === 'string' ? JSON.parse(value) : value]));

export class D1Database implements Database {
  constructor(private url: string, private token: string, private fetchImpl = fetch) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
      throw new Error('D1_URL must use HTTPS (or localhost for development)');
    }
    if (!token) throw new Error('D1_TOKEN is required');
  }
  async batch(statements: Statement[]) {
    if (!statements.length) return [];
    const res = await this.fetchImpl(this.url, {
      method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ statements }), signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`D1 query failed (HTTP ${res.status})`);
    const body = await res.json() as { results: { results: Record<string, unknown>[]; meta: { changes: number }; success: boolean }[] };
    if (!Array.isArray(body.results) || body.results.length !== statements.length || body.results.some((r) => !r.success)) {
      throw new Error('D1 returned an incomplete batch');
    }
    return body.results.map((r) => ({ rows: r.results.map(decodeRow), rowCount: r.meta.changes }));
  }
  async query(sql: string, params: unknown[] = []) { return (await this.batch([{ sql, params }]))[0]; }
}

export function databaseFromEnv(env: NodeJS.ProcessEnv = process.env): Database | null {
  if (!env.D1_URL && !env.D1_TOKEN) return null;
  if (!env.D1_URL || !env.D1_TOKEN) throw new Error('D1_URL and D1_TOKEN must both be configured');
  return new D1Database(env.D1_URL, env.D1_TOKEN);
}
