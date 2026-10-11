-- More paid work counts against the processing limits: a second or third attempt at a skill or short
-- (server/src/outputs/store.ts) is a charged 'retry' start, and each agent brief the processor writes
-- (server/src/outputs/handoff-api.ts, one gpt-5 call) is a charged 'handoff' start. Not yet applied to TigerData.

BEGIN;

ALTER TABLE processing_starts DROP CONSTRAINT processing_starts_kind_check;
ALTER TABLE processing_starts ADD CONSTRAINT processing_starts_kind_check CHECK (kind IN ('extract', 'digest', 'retry', 'handoff'));

COMMIT;
