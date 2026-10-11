// GET /api/feed: ready, rendered shorts as the reel plays them (spec: "Feed read contract").

import { resolveMediaRef } from "./media.js";

/**
 * One row per artifact revision whose processing is ready and whose video is rendered. With unit ids, only artifacts built from those units; without, the curated demo feed,
 * which also needs a team-assigned feed_order.
 */
export async function readFeed(sql, unitIds = null) {
  if (unitIds && unitIds.length === 0) return [];
  const list = unitIds ? unitIds.join(",") : null;
  const rows = await sql`
    SELECT * FROM (
      SELECT DISTINCT ON (a.id, a.version)
        a.id, a.version, a.name, a.category, a.source_url, a.sources, a.selection_reason, a.created_at,
        v.id AS video_id, v.media_ref, v.caption_ref, v.duration_seconds, v.feed_order,
        s.id AS skill_id, s.status AS skill_status
      FROM artifacts a
      JOIN video_results v
        ON v.artifact_id = a.id AND v.artifact_version = a.version
       AND v.status = 'ready'
      LEFT JOIN LATERAL (
        SELECT id, status FROM skill_results s
        WHERE s.artifact_id = a.id AND s.artifact_version = a.version
        ORDER BY s.created_at DESC, s.id DESC LIMIT 1
      ) s ON true
      WHERE a.ingestion_status = 'ready'
        -- A user's feed has only digests built entirely from their own imports, never someone else's videos.
        AND (${list}::text IS NULL OR a.source_ids <@ string_to_array(${list}::text, ',')::uuid[])
        AND (${list}::text IS NOT NULL OR v.feed_order IS NOT NULL)
      ORDER BY a.id, a.version, v.created_at DESC, v.id DESC
    ) eligible
    ORDER BY feed_order NULLS LAST, created_at, id`;
  return rows.map(serializeItem).filter(Boolean);
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
      url: media,
      captions_url: resolveMediaRef(row.caption_ref),
      duration_seconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      feed_order: row.feed_order ?? null,
    },
    skill: row.skill_id ? { id: row.skill_id, status: row.skill_status } : null,
  };
}
