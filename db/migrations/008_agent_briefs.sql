-- Workflow 3 handoff: the prompt a user gives their coding agent for the skills they picked. Not yet applied to TigerData.
-- The web Worker inserts a pending row keyed by the exact skill revisions picked; the processor merges those skills into
-- one brief and writes a prompt for every agent and mode, so switching agent or mode needs no model call.
-- Copying a prompt is an export, not a delivery: receipts stay in `handoffs`.

BEGIN;

CREATE TABLE agent_briefs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  skill_result_ids  uuid[]      NOT NULL,
  input_key         text        NOT NULL,           -- sorted skill ids + their updated_at + prompt revision
  status            processing_status NOT NULL DEFAULT 'pending',
  claim_token       uuid,                           -- the worker holding a running brief; only it may settle it
  brief             jsonb,                          -- merged themes, tensions, ordered actions
  prompts           jsonb,                          -- { <agent>: { review, apply } }
  prompt_revision   text,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_brief_has_skills CHECK (cardinality(skill_result_ids) >= 1),
  CONSTRAINT agent_brief_ready_has_prompts CHECK (status <> 'ready' OR prompts IS NOT NULL),
  UNIQUE (user_id, input_key)
);

COMMIT;
