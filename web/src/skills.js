// GET /api/skills: the skills and tasks the processor wrote for a user's imports (workflow 3). Skill readiness
// is separate from the video: a skill can be ready while its short is still rendering, or after it failed.

import { FRONTMATTER } from "../public/agents.js";

/**
 * The newest skill result per ready artifact revision built only from these units (all of the user's imports),
 * newest artifact first, with its
 * tasks in order and the contributing videos (so tasks can link their evidence to the right moment).
 */
export async function readSkills(sql, unitIds) {
  if (unitIds.length === 0) return [];
  const list = unitIds.join(",");
  const rows = await sql`
    SELECT * FROM (
      SELECT DISTINCT ON (a.id, a.version)
        a.id AS artifact_id, a.version AS artifact_version, a.name AS artifact_name, a.category, a.created_at,
        s.id, s.status, s.error, s.skill_markdown,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', i.id, 'task', i.task, 'prerequisites', i.prerequisites, 'steps', i.steps,
            'completion_check', i.completion_check, 'source_refs', i.source_refs, 'evidence', i.applicability_evidence
          ) ORDER BY i.position, i.created_at)
          FROM action_items i WHERE i.skill_result_id = s.id), '[]') AS action_items,
        COALESCE((
          SELECT json_agg(json_build_object('id', u.id, 'url', u.source_url, 'title', u.title)
                          ORDER BY array_position(a.source_ids, u.id))
          FROM ingested_units u WHERE u.id = ANY (a.source_ids)), '[]') AS videos
      FROM artifacts a
      JOIN skill_results s ON s.artifact_id = a.id AND s.artifact_version = a.version
      WHERE a.ingestion_status = 'ready'
        -- Only digests built entirely from this user's videos: a shared digest never shows another person's imports.
        AND a.source_ids <@ string_to_array(${list}::text, ',')::uuid[]
      ORDER BY a.id, a.version, s.created_at DESC, s.id DESC
    ) newest
    ORDER BY created_at DESC, artifact_id`;
  return rows.map(serializeSkill);
}

/** name and description from SKILL.md frontmatter; null when absent. */
export function frontmatter(markdown) {
  const m = FRONTMATTER.exec(markdown ?? "");
  const out = { name: null, description: null };
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const kv = /^(name|description):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); } catch {}
    }
    out[kv[1]] = value || null;
  }
  return out;
}

const text = (v) => (typeof v === "string" ? v : "");
const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()) : []);

export function serializeSkill(row) {
  const ready = row.status === "ready" && typeof row.skill_markdown === "string";
  const { name, description } = ready ? frontmatter(row.skill_markdown) : { name: null, description: null };
  const videos = (row.videos ?? []).filter((v) => /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(v.url));
  return {
    id: row.id,
    status: row.status,
    error: row.status === "failed" ? row.error ?? null : null,
    artifact: { id: row.artifact_id, version: row.artifact_version, name: row.artifact_name, category: row.category ?? null },
    name,
    description,
    markdown: ready ? row.skill_markdown : null,
    videos,
    action_items: ready
      ? (row.action_items ?? []).map((i) => ({
          id: i.id,
          task: text(i.task),
          prerequisites: strings(i.prerequisites),
          steps: strings(i.steps),
          completion_check: text(i.completion_check),
          evidence: (Array.isArray(i.evidence) ? i.evidence : [])
            .filter((e) => e && typeof e.passage === "string")
            .map((e) => ({
              source_id: e.source_id ?? null,
              passage: e.passage,
              start_seconds: Number.isFinite(e.start_seconds) ? e.start_seconds : null,
              end_seconds: Number.isFinite(e.end_seconds) ? e.end_seconds : null,
            })),
        }))
      : [],
  };
}
