// D1 keeps structured values as JSON text; API callers continue to receive objects and arrays.
const JSON_COLUMNS = new Set(['facts', 'few_shot', 'transcript', 'source_ids', 'sources', 'evidence', 'script',
  'supporting_refs', 'applicability_evidence', 'prerequisites', 'steps', 'source_refs', 'payload', 'verification',
  'skill_result_ids', 'brief', 'prompts', 'action_items', 'videos', 'artifacts', 'exclusions', 'unit_titles', 'unit_urls', 'source_units']);

export function decodeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, JSON_COLUMNS.has(key) && typeof value === 'string' ? JSON.parse(value) : value]));
}

export function connect(env) {
  if (!env.DB) return null;
  const sql = async (parts, ...values) => {
    const query = parts.reduce((text, part, i) => text + (i ? '?' : '') + part, '');
    const { results } = await env.DB.prepare(query).bind(...values).all();
    return results.map(decodeRow);
  };
  return sql;
}
