-- Output retries count against the processing limits (server/src/outputs/store.ts): a second or third attempt at a
-- skill or short is a charged processing_starts row with kind 'retry'. Not yet applied to TigerData.

BEGIN;

ALTER TABLE processing_starts DROP CONSTRAINT processing_starts_kind_check;
ALTER TABLE processing_starts ADD CONSTRAINT processing_starts_kind_check CHECK (kind IN ('extract', 'digest', 'retry'));

COMMIT;
