// GET /api/skills: the skills the processor wrote for a user's imports (workflow 3). Skill readiness
// is separate from the video: a skill can be ready while its short is still rendering, or after it failed.

import { dedupeContent } from "./content.js";
import { FRONTMATTER } from "../public/agents.js";
import { willRetry } from "./imports.js";
import { readFeed } from "./feed.js";
import { skillStatus } from "./skill-policy.js";

/**
 * The newest skill result per ready artifact revision built only from these units (all of the user's imports),
 * newest artifact first, with its contributing sources. Public reads require a team-assigned feed_order.
 */
export async function readSkills(sql, unitIds) {
  if (unitIds && unitIds.length === 0) return [];
  const rows = await sql`
    SELECT a.id AS artifact_id, a.version AS artifact_version, a.name AS artifact_name, a.category, a.created_at,
      s.id, s.status, s.error, s.attempts, s.skill_markdown, s.review_feedback,
      a.source_url,
      (SELECT json_group_array(json_object('source_url',u.source_url,'start_seconds',u.start_seconds)) FROM json_each(a.source_ids) src JOIN ingested_units u ON u.id=src.value) AS source_units,
      (SELECT json_group_array(json(item)) FROM (
        SELECT json_object('id', u.id, 'url', u.source_url, 'title', u.title) AS item
        FROM json_each(a.source_ids) src JOIN ingested_units u ON u.id = src.value ORDER BY CAST(src.key AS INTEGER))) AS videos
    FROM artifacts a
    JOIN skill_results s ON s.artifact_id = a.id AND s.artifact_version = a.version
    WHERE a.ingestion_status = 'ready'
      AND (${unitIds === null ? 1 : 0}=1 OR NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) WHERE value NOT IN (SELECT value FROM json_each(${JSON.stringify(unitIds ?? [])}))))
      AND (${unitIds === null ? 1 : 0}=0 OR (s.status='ready' AND EXISTS(SELECT 1 FROM video_results v WHERE v.artifact_id=a.id AND v.artifact_version=a.version AND v.feed_order IS NOT NULL)))
    ORDER BY a.created_at DESC, a.id`;
  const displayed = new Set((await readFeed(sql, unitIds)).map((item) => `${item.id}:${item.version}`));
  return dedupeContent([
    ...rows.filter((row) => displayed.has(`${row.artifact_id}:${row.artifact_version}`)),
    ...rows.filter((row) => !displayed.has(`${row.artifact_id}:${row.artifact_version}`)),
  ]).map(serializeSkill);
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

export function serializeSkill(row) {
  // A failed skill with attempts left is written again by the processor's sweep.
  const retrying = willRetry(row);
  const status = skillStatus(row.status, row.review_feedback);
  const ready = status === "ready" && typeof row.skill_markdown === "string";
  const { name, description } = ready ? frontmatter(row.skill_markdown) : { name: null, description: null };
  // The artifact's sources: YouTube videos, X posts and Substack posts, only in their canonical forms.
  const videos = (row.videos ?? []).filter((v) => /^https:\/\/(?:www\.youtube\.com\/watch\?v=[\w-]{11}|x\.com\/i\/status\/\d{1,19}|[a-z0-9-]+\.substack\.com\/p\/[\w-]+)$/.test(v.url));
  return {
    id: row.id,
    status,
    error: row.status === "failed" ? row.error ?? null : null,
    retrying,
    artifact: { id: row.artifact_id, version: row.artifact_version, name: row.artifact_name, category: row.category ?? null },
    name,
    description,
    markdown: ready ? row.skill_markdown : null,
    videos,
    action_items: [],
  };
}
