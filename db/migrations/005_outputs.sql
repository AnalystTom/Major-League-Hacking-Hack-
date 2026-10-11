-- Processor outputs: rendered shorts (workflow 2) and skills with tasks (workflow 3). Not yet applied to TigerData.
--
-- 1. A unit records when it was claimed, so one left `running` by a crashed processor can be reclaimed.
-- 2. One video result and one skill result per artifact revision (the v0 contract). The processor claims
--    work by inserting that row with a claim token, and a retry updates it. Before applying, check for duplicates:
--      SELECT artifact_id, artifact_version, count(*) FROM video_results GROUP BY 1, 2 HAVING count(*) > 1;
--      SELECT artifact_id, artifact_version, count(*) FROM skill_results GROUP BY 1, 2 HAVING count(*) > 1;
-- 3. A ready video needs its media, captions, narration and a positive measured duration. Music stays
--    optional until a licensed track is chosen; music_ref and music_provenance record it once there is one.

BEGIN;

ALTER TABLE ingested_units ADD COLUMN claimed_at timestamptz;

CREATE UNIQUE INDEX video_results_artifact_revision_key ON video_results (artifact_id, artifact_version);
CREATE UNIQUE INDEX skill_results_artifact_revision_key ON skill_results (artifact_id, artifact_version);

-- Each claim gets a fresh token, and a worker only writes its result while the token is still its own, so one
-- whose claim went stale can't overwrite the worker that took over.
ALTER TABLE video_results ADD COLUMN claim_token uuid;
ALTER TABLE skill_results ADD COLUMN claim_token uuid;

ALTER TABLE video_results DROP CONSTRAINT video_ready_has_media;
ALTER TABLE video_results ADD CONSTRAINT video_ready_has_media CHECK (
  status <> 'ready' OR (coalesce(media_ref, '') <> '' AND coalesce(caption_ref, '') <> ''
    AND coalesce(narration_ref, '') <> '' AND coalesce(duration_seconds, 0) > 0));

COMMIT;
