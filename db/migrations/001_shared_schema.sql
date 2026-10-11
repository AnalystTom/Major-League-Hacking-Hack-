-- Resurface v0 shared TigerData schema (see docs/project-actions-spec.md).
-- Workflow 1 owns this migration and the ingestion/artifact tables.
-- Workflow 2 writes only video_results; workflow 3 writes only skill_results,
-- action_items and handoffs. Category values are dynamic free text, never an enum.

BEGIN;

CREATE TYPE processing_status AS ENUM ('pending', 'running', 'ready', 'failed');
CREATE TYPE review_status     AS ENUM ('pending', 'approved', 'rejected');

-- Project brief the artifacts are matched against (versioned; unknowns stay NULL/absent).
CREATE TABLE project_contexts (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  version     integer     NOT NULL,
  name        text        NOT NULL,
  goal        text,
  facts       jsonb       NOT NULL DEFAULT '[]',  -- [{fact, source}] implementation facts, blocker, tools, constraints
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

-- Stored Digestion Prompt revisions and reviewed few-shot sets.
CREATE TABLE digestion_prompts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL DEFAULT 'Digestion Prompt',
  revision       integer     NOT NULL,
  prompt_text    text        NOT NULL,
  few_shot       jsonb       NOT NULL DEFAULT '[]',  -- reviewed input -> output examples
  review_status  review_status NOT NULL DEFAULT 'pending',
  review_note    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, revision)
);

-- One submitted YouTube video = one ingested unit.
CREATE TABLE ingested_units (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_url      text        NOT NULL,           -- original, preserved verbatim
  source_url         text        NOT NULL,           -- canonical, list/index params stripped
  start_seconds      integer,                        -- selected start time, if supplied
  title              text,                           -- actual retrieved title only
  content_type       text        NOT NULL DEFAULT 'youtube_video',
  raw_artifact_ref   text,                           -- storage ref to raw text/transcript
  transcript         jsonb,                          -- timestamped segments when available
  extraction_method  text,
  extracted_at       timestamptz,
  status             processing_status NOT NULL DEFAULT 'pending',
  error              text,                           -- actual failure reason; NULL if unknown
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- ready requires usable content, not page metadata alone
  CONSTRAINT unit_ready_has_content CHECK (status <> 'ready' OR raw_artifact_ref IS NOT NULL OR transcript IS NOT NULL)
);
CREATE INDEX ingested_units_source_url_idx ON ingested_units (source_url);
CREATE INDEX ingested_units_status_idx     ON ingested_units (status);

-- Final artifact = one processed topic, possibly from several units.
CREATE TABLE artifacts (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version                  integer     NOT NULL DEFAULT 1,
  name                     text        NOT NULL,
  source_url               text        NOT NULL,     -- primary source
  source_ids               uuid[]      NOT NULL,     -- contributing ingested_units.id
  sources                  jsonb       NOT NULL DEFAULT '[]',  -- [{url,title,content_type,retrieved_at}]
  raw_artifact_ref         text,
  processed_text           text,                     -- source-grounded synthesis for Opus
  category                 text,                     -- dynamic, from collection + prompt
  selection_reason         text,
  evidence                 jsonb       NOT NULL DEFAULT '[]',  -- passages/timestamps; conflicts preserved
  project_context_id       uuid,
  project_context_version  integer,
  digestion_prompt_id      uuid        REFERENCES digestion_prompts (id),
  ingestion_status         processing_status NOT NULL DEFAULT 'pending',
  review_status            review_status     NOT NULL DEFAULT 'pending',
  review_feedback          text,
  processed_at             timestamptz,
  error                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_context_id, project_context_version)
    REFERENCES project_contexts (id, version),
  CONSTRAINT artifact_ready_has_text CHECK (ingestion_status <> 'ready' OR processed_text IS NOT NULL),
  CONSTRAINT artifact_has_sources    CHECK (cardinality(source_ids) >= 1),
  UNIQUE (id, version)
);
CREATE INDEX artifacts_category_idx ON artifacts (category);
CREATE INDEX artifacts_source_ids_idx ON artifacts USING gin (source_ids);

-- Usable-but-unselected sources, tied to the prompt revision that excluded them.
CREATE TABLE artifact_exclusions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id              uuid        NOT NULL REFERENCES ingested_units (id),
  digestion_prompt_id  uuid        NOT NULL REFERENCES digestion_prompts (id),
  reason               text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Workflow 2 output. Rows exist only as status records until media is actually rendered.
CREATE TABLE video_results (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id              uuid        NOT NULL,
  artifact_version         integer     NOT NULL,
  project_context_version  integer,
  script                   jsonb,                    -- timed script
  opus_prompt_revision     text,
  media_ref                text,
  caption_ref              text,
  narration_ref            text,
  music_ref                text,
  music_provenance         text,
  duration_seconds         numeric(6,2),             -- measured, not targeted
  status                   processing_status NOT NULL DEFAULT 'pending',
  review_status            review_status     NOT NULL DEFAULT 'pending',
  review_feedback          text,
  feed_order               integer,                  -- manually reviewed demo order
  error                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (artifact_id, artifact_version) REFERENCES artifacts (id, version),
  CONSTRAINT video_ready_has_media CHECK (
    status <> 'ready' OR (media_ref IS NOT NULL AND caption_ref IS NOT NULL
      AND narration_ref IS NOT NULL AND music_ref IS NOT NULL AND duration_seconds IS NOT NULL))
);
CREATE INDEX video_results_artifact_idx ON video_results (artifact_id, artifact_version);

-- Workflow 3 output.
CREATE TABLE skill_results (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id              uuid        NOT NULL,
  artifact_version         integer     NOT NULL,
  project_context_version  integer,
  skill_markdown           text,                     -- SKILL.md content; NULL until generated
  supporting_refs          jsonb       NOT NULL DEFAULT '[]',
  status                   processing_status NOT NULL DEFAULT 'pending',
  review_status            review_status     NOT NULL DEFAULT 'pending',
  review_feedback          text,
  error                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (artifact_id, artifact_version) REFERENCES artifacts (id, version),
  CONSTRAINT skill_ready_has_markdown CHECK (status <> 'ready' OR skill_markdown IS NOT NULL),
  UNIQUE (id, artifact_id)
);
CREATE INDEX skill_results_artifact_idx ON skill_results (artifact_id, artifact_version);

CREATE TABLE action_items (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_result_id       uuid        NOT NULL REFERENCES skill_results (id) ON DELETE CASCADE,
  task                  text        NOT NULL,
  applicability_evidence jsonb      NOT NULL DEFAULT '[]',
  prerequisites         jsonb       NOT NULL DEFAULT '[]',
  steps                 jsonb       NOT NULL DEFAULT '[]',
  source_refs           jsonb       NOT NULL DEFAULT '[]',
  completion_check      text        NOT NULL,
  position              integer     NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX action_items_skill_idx ON action_items (skill_result_id);

CREATE TABLE handoffs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_result_id     uuid        NOT NULL REFERENCES skill_results (id),
  action_item_id      uuid        REFERENCES action_items (id),
  payload             jsonb       NOT NULL,          -- exact reviewed payload, preserved on failure
  destination         text        NOT NULL,
  delivery_status     processing_status NOT NULL DEFAULT 'pending',  -- ready = acknowledged receipt
  receipt             text,                          -- delivery acknowledgement (not completion)
  result_ref          text,
  verification        jsonb,                         -- evidence the result was checked
  idempotency_key     text        NOT NULL UNIQUE,   -- retry without duplicating received work
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handoff_ready_has_receipt CHECK (delivery_status <> 'ready' OR receipt IS NOT NULL)
);

-- Feed/CTA read model: consumable only with matching version, ready processing.
CREATE VIEW artifact_feed AS
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
