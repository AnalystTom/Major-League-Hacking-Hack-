-- The ledger the processing limits count (server/src/ingest/limits.ts). Follows 006, which added
-- ingested_units.deferred_until. Not yet applied to TigerData.
--
-- Every paid start is a row. Every extraction the processor starts is charged. A digest is charged too, unless it's
-- the first digest after that unit's extraction (the extraction's charge covers it), so a new video costs one slot
-- while re-digests of shared videos and digest retries cost their own. Units started before this migration have no
-- rows, so their first digest afterwards is charged; that only errs toward spending less.

BEGIN;

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
