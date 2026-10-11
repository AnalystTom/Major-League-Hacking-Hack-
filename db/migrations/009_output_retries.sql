-- Failed skills and shorts are retried a few times instead of staying failed after one provider error.
-- attempts counts claims of the row (src/outputs/store.ts: MAX_OUTPUT_ATTEMPTS, RETRY_AFTER_MINUTES). Not yet applied to TigerData.

BEGIN;

ALTER TABLE skill_results ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE video_results ADD COLUMN attempts integer NOT NULL DEFAULT 0;
-- Rows that already ran once count as one attempt.
UPDATE skill_results SET attempts = 1 WHERE status <> 'pending';
UPDATE video_results SET attempts = 1 WHERE status <> 'pending';

COMMIT;
