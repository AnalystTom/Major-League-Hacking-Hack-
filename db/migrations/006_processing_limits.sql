-- Processing limits (server/src/ingest/limits.ts): at most DAILY_VIDEO_LIMIT new units start per UTC day and
-- MONTHLY_VIDEO_LIMIT per UTC month, across all users. A unit counts when the processor claims it (claimed_at),
-- which is when provider spend starts. Units over the limit stay pending with deferred_until set, so the page can
-- say when they'll start, and the sweep claims them once there is room. Not yet applied to TigerData.

BEGIN;

ALTER TABLE ingested_units ADD COLUMN deferred_until timestamptz;
CREATE INDEX ingested_units_claimed_at_idx ON ingested_units (claimed_at);

COMMIT;
