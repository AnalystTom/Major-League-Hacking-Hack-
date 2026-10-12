// GET /api/skills: the skills and tasks the processor wrote for a user's imports (workflow 3). Skill readiness
// is separate from the video: a skill can be ready while its short is still rendering, or after it failed.

import { FRONTMATTER } from "../public/agents.js";
import { willRetry } from "./imports.js";

/**
 * The newest skill result per ready artifact revision built only from these units (all of the user's imports),
 * newest artifact first, with its
 * tasks in order and the contributing videos (so tasks can link their evidence to the right moment).
 */
export async function readSkills(sql, unitIds) {
  if (unitIds.length === 0) return [];
  const rows = await sql`
    SELECT a.id AS artifact_id, a.version AS artifact_version, a.name AS artifact_name, a.category, a.created_at,
      s.id, s.status, s.error, s.attempts, s.skill_markdown,
      (SELECT json_group_array(json(item)) FROM (
        SELECT json_object('id', i.id, 'task', i.task, 'prerequisites', json(i.prerequisites), 'steps', json(i.steps),
          'completion_check', i.completion_check, 'source_refs', json(i.source_refs), 'evidence', json(i.applicability_evidence)) AS item
        FROM action_items i WHERE i.skill_result_id = s.id ORDER BY i.position, i.created_at)) AS action_items,
      (SELECT json_group_array(json(item)) FROM (
        SELECT json_object('id', u.id, 'url', u.source_url, 'title', u.title) AS item
        FROM json_each(a.source_ids) src JOIN ingested_units u ON u.id = src.value ORDER BY CAST(src.key AS INTEGER))) AS videos
    FROM artifacts a
    JOIN skill_results s ON s.artifact_id = a.id AND s.artifact_version = a.version
    WHERE a.ingestion_status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) WHERE value NOT IN (SELECT value FROM json_each(${JSON.stringify(unitIds)})))
    ORDER BY a.created_at DESC, a.id`;
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
  // A failed skill with attempts left is written again by the processor's sweep.
  const retrying = willRetry(row);
  const ready = row.status === "ready" && typeof row.skill_markdown === "string";
  const { name, description } = ready ? frontmatter(row.skill_markdown) : { name: null, description: null };
  // The artifact's sources: YouTube videos, X posts and Substack posts, only in their canonical forms.
  const videos = (row.videos ?? []).filter((v) => /^https:\/\/(?:www\.youtube\.com\/watch\?v=[\w-]{11}|x\.com\/i\/status\/\d{1,19}|[a-z0-9-]+\.substack\.com\/p\/[\w-]+)$/.test(v.url));
  return {
    id: row.id,
    status: row.status,
    error: row.status === "failed" ? row.error ?? null : null,
    retrying,
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
