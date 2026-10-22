// GET /api/feed: ready, rendered shorts as the reel plays them (spec: "Feed read contract").

import { dedupeContent } from "./content.js";
import { resolveMediaRef } from "./media.js";

/**
 * One row per artifact revision whose processing is ready and whose video is rendered. With unit ids, only artifacts built from those units; without, the curated demo feed,
 * which also needs a team-assigned feed_order.
 */
export async function readFeed(sql, unitIds = null) {
  if (unitIds && unitIds.length === 0) return [];
  const rows = await sql`
    SELECT a.id, a.version, a.name, a.category, a.source_url, a.sources, a.selection_reason, a.created_at,
      (SELECT json_group_array(u.source_url) FROM json_each(a.source_ids) src JOIN ingested_units u ON u.id=src.value) AS source_urls,
      v.id AS video_id, v.media_ref, v.caption_ref, v.duration_seconds, v.feed_order,
      s.id AS skill_id, s.status AS skill_status
    FROM artifacts a
    JOIN video_results v ON v.artifact_id = a.id AND v.artifact_version = a.version AND v.status = 'ready'
      AND v.review_status = 'approved' AND json_extract(iif(json_valid(v.review_feedback),v.review_feedback,'{}'), '$.judge') = 'short-judge-v1'
      AND json_extract(iif(json_valid(v.review_feedback),v.review_feedback,'{}'), '$.passed') = 1 AND json_extract(iif(json_valid(v.review_feedback),v.review_feedback,'{}'), '$.captions_burned') = 1
    LEFT JOIN skill_results s ON s.artifact_id = a.id AND s.artifact_version = a.version
    WHERE a.ingestion_status = 'ready'
      AND (${unitIds === null ? 1 : 0} = 1 OR NOT EXISTS (
        SELECT 1 FROM json_each(a.source_ids) WHERE value NOT IN (SELECT value FROM json_each(${JSON.stringify(unitIds ?? [])}))))
      AND (${unitIds === null ? 1 : 0} = 0 OR v.feed_order IS NOT NULL)
    ORDER BY v.feed_order IS NULL, v.feed_order, a.created_at DESC, a.version DESC, a.id`;
  return dedupeContent(rows.filter((r) => resolveMediaRef(r.media_ref))).map(serializeItem);
}

/** The API shape for one row; null when its video can't be served, so the reel never shows a dead clip. */
export function serializeItem(row) {
  const media = resolveMediaRef(row.media_ref);
  if (!media) return null;
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    category: row.category ?? null,
    source_url: row.source_url,
    sources: row.sources ?? [],
    selection_reason: row.selection_reason ?? null,
    video: {
      id: row.video_id,
      subtitles_burned: true,
      url: media,
      captions_url: resolveMediaRef(row.caption_ref),
      duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      feed_order: row.feed_order ?? null,
    },
    skill: row.skill_id ? { id: row.skill_id, status: row.skill_status } : null,
  };
}

/** R2 keys use the same ownership and judge gate as the feed, including direct URL requests. */
export async function canReadMedia(sql, key, unitIds) {
  const rows = await sql`
    SELECT a.id FROM artifacts a JOIN video_results v ON v.artifact_id=a.id AND v.artifact_version=a.version
    WHERE a.ingestion_status='ready' AND v.status='ready' AND v.review_status='approved'
      AND json_extract(iif(json_valid(v.review_feedback),v.review_feedback,'{}'), '$.judge')='short-judge-v1'
      AND json_extract(iif(json_valid(v.review_feedback),v.review_feedback,'{}'), '$.passed')=1 AND json_extract(iif(json_valid(v.review_feedback),v.review_feedback,'{}'), '$.captions_burned')=1
      AND (v.media_ref=${`r2:${key}`} OR v.caption_ref=${`r2:${key}`})
      AND (v.feed_order IS NOT NULL OR (json_array_length(a.source_ids)>0 AND NOT EXISTS (
        SELECT 1 FROM json_each(a.source_ids) WHERE value NOT IN (SELECT value FROM json_each(${JSON.stringify(unitIds)}))))) LIMIT 1`;
  return rows.length > 0;
}
