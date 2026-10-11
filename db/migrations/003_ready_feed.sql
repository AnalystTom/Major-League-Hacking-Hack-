-- Remove manual approval gates; preserve existing records and review metadata.
BEGIN;

-- Feed/CTA read model: consumable only with matching version, ready processing.
CREATE OR REPLACE VIEW artifact_feed AS
SELECT a.id, a.version, a.name, a.category, a.source_url, a.sources, a.selection_reason,
       v.id AS video_result_id, v.media_ref, v.caption_ref, v.duration_seconds, v.feed_order,
       s.id AS skill_result_id, s.status AS skill_status, s.review_status AS skill_review_status
FROM artifacts a
JOIN video_results v
  ON v.artifact_id = a.id AND v.artifact_version = a.version
 AND v.status = 'ready'
LEFT JOIN skill_results s
  ON s.artifact_id = a.id AND s.artifact_version = a.version
WHERE a.ingestion_status = 'ready';

COMMIT;
