-- Processing limits (server/src/ingest/limits.ts): at most DAILY_VIDEO_LIMIT charged starts per UTC day and
-- MONTHLY_VIDEO_LIMIT per UTC month, across all users. Not yet applied to TigerData.
--
-- processing_starts is the ledger the limits count. Every extraction the processor starts is charged. A digest is
-- charged too, unless it's the first digest after that unit's extraction (the extraction's charge covers it), so a
-- new video costs one slot while re-digests of shared videos and digest retries cost their own.
-- Units over the limit keep their status with deferred_until set, so the page can say when they'll start, and
-- the sweeps pick them up once there is room.

BEGIN;

ALTER TABLE ingested_units ADD COLUMN deferred_until timestamptz;

CREATE TABLE processing_starts (
  id          bigserial   PRIMARY KEY,
  unit_id     uuid        NOT NULL REFERENCES ingested_units (id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('extract', 'digest')),
  charged     boolean     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processing_starts_created_at_idx ON processing_starts (created_at);
CREATE INDEX processing_starts_unit_idx ON processing_starts (unit_id, created_at);

COMMIT;
