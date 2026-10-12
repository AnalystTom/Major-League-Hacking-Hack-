-- D1 application schema; retains all PostgreSQL IDs, credentials, JSON and references.


CREATE TABLE project_contexts (
  id          text        NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  version     integer     NOT NULL,
  name        text        NOT NULL,
  goal        text,
  facts       text       NOT NULL DEFAULT '[]' CHECK (facts IS NULL OR json_valid(facts)),
  created_at  text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (id, version)
);

CREATE TABLE digestion_prompts (
  id             text        PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  name           text        NOT NULL DEFAULT 'Digestion Prompt',
  revision       integer     NOT NULL,
  prompt_text    text        NOT NULL,
  few_shot       text       NOT NULL DEFAULT '[]' CHECK (few_shot IS NULL OR json_valid(few_shot)),
  review_status   TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  review_note    text,
  created_at     text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (name, revision)
);

CREATE TABLE ingested_units (
  id                 text        PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  submitted_url      text        NOT NULL,
  source_url         text        NOT NULL,
  start_seconds      integer,
  title              text,
  content_type       text        NOT NULL DEFAULT 'youtube_video',
  raw_artifact_ref   text,
  transcript         text CHECK (transcript IS NULL OR json_valid(transcript)),
  extraction_method  text,
  extracted_at       text,
  claimed_at         text,
  deferred_until     text,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ready','failed')),
  error              text,
  created_at         text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  CONSTRAINT unit_ready_has_content CHECK (status <> 'ready' OR raw_artifact_ref IS NOT NULL OR transcript IS NOT NULL)
);
CREATE INDEX ingested_units_source_url_idx ON ingested_units (source_url);
CREATE INDEX ingested_units_status_idx     ON ingested_units (status);

CREATE TABLE artifacts (
  id                       text        NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  version                  integer     NOT NULL DEFAULT 1,
  name                     text        NOT NULL,
  source_url               text        NOT NULL,
  source_ids               text      NOT NULL CHECK (source_ids IS NULL OR json_valid(source_ids)),
  sources                  text       NOT NULL DEFAULT '[]' CHECK (sources IS NULL OR json_valid(sources)),
  raw_artifact_ref         text,
  processed_text           text,
  category                 text,
  selection_reason         text,
  evidence                 text       NOT NULL DEFAULT '[]' CHECK (evidence IS NULL OR json_valid(evidence)),
  project_context_id       text,
  project_context_version  integer,
  digestion_prompt_id      text        REFERENCES digestion_prompts (id),
  ingestion_status         text NOT NULL DEFAULT 'pending' CHECK (ingestion_status IN ('pending','running','ready','failed')),
  review_status                 TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  review_feedback          text,
  processed_at             text,
  error                    text,
  created_at               text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (project_context_id, project_context_version)
    REFERENCES project_contexts (id, version),
  CONSTRAINT artifact_ready_has_text CHECK (ingestion_status <> 'ready' OR processed_text IS NOT NULL),
  CONSTRAINT artifact_has_sources    CHECK (json_array_length(source_ids) >= 1),
  PRIMARY KEY (id, version),
  CHECK (version >= 1)
);
CREATE INDEX artifacts_category_idx ON artifacts (category);
CREATE INDEX artifacts_created_at_idx ON artifacts (created_at);

CREATE TABLE artifact_exclusions (
  id                   text        PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  unit_id              text        NOT NULL REFERENCES ingested_units (id),
  digestion_prompt_id  text        NOT NULL REFERENCES digestion_prompts (id),
  reason               text        NOT NULL,
  created_at           text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE video_results (
  id                       text        PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  artifact_id              text        NOT NULL,
  artifact_version         integer     NOT NULL,
  project_context_version  integer,
  script                   text CHECK (script IS NULL OR json_valid(script)),
  opus_prompt_revision     text,
  media_ref                text,
  caption_ref              text,
  narration_ref            text,
  music_ref                text,
  music_provenance         text,
  duration_seconds         real,
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ready','failed')),
  review_status                 TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  review_feedback          text,
  feed_order               integer,
  error                    text,
  created_at               text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  claim_token text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  FOREIGN KEY (artifact_id, artifact_version) REFERENCES artifacts (id, version),
  CONSTRAINT video_ready_has_media CHECK (
    status <> 'ready' OR (media_ref IS NOT NULL AND caption_ref IS NOT NULL
      AND narration_ref IS NOT NULL AND duration_seconds > 0
      AND media_ref <> '' AND caption_ref <> '' AND narration_ref <> '')),
  UNIQUE (artifact_id, artifact_version)
);
CREATE INDEX video_results_artifact_idx ON video_results (artifact_id, artifact_version);

CREATE TABLE skill_results (
  id                       text        PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  artifact_id              text        NOT NULL,
  artifact_version         integer     NOT NULL,
  project_context_version  integer,
  skill_markdown           text,
  supporting_refs          text       NOT NULL DEFAULT '[]' CHECK (supporting_refs IS NULL OR json_valid(supporting_refs)),
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ready','failed')),
  review_status                 TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  review_feedback          text,
  error                    text,
  created_at               text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  claim_token text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  FOREIGN KEY (artifact_id, artifact_version) REFERENCES artifacts (id, version),
  CONSTRAINT skill_ready_has_markdown CHECK (status <> 'ready' OR skill_markdown IS NOT NULL),
  UNIQUE (id, artifact_id),
  UNIQUE (artifact_id, artifact_version)
);
CREATE INDEX skill_results_artifact_idx ON skill_results (artifact_id, artifact_version);

CREATE TABLE action_items (
  id                    text        PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  skill_result_id       text        NOT NULL REFERENCES skill_results (id) ON DELETE CASCADE,
  task                  text        NOT NULL,
  applicability_evidence text      NOT NULL DEFAULT '[]' CHECK (applicability_evidence IS NULL OR json_valid(applicability_evidence)),
  prerequisites         text       NOT NULL DEFAULT '[]' CHECK (prerequisites IS NULL OR json_valid(prerequisites)),
  steps                 text       NOT NULL DEFAULT '[]' CHECK (steps IS NULL OR json_valid(steps)),
  source_refs           text       NOT NULL DEFAULT '[]' CHECK (source_refs IS NULL OR json_valid(source_refs)),
  completion_check      text        NOT NULL,
  position              integer     NOT NULL DEFAULT 0,
  created_at            text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX action_items_skill_idx ON action_items (skill_result_id);

CREATE TABLE handoffs (
  id                  text        PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  skill_result_id     text        NOT NULL REFERENCES skill_results (id),
  action_item_id      text        REFERENCES action_items (id),
  payload             text       NOT NULL CHECK (payload IS NULL OR json_valid(payload)),
  destination         text        NOT NULL,
  delivery_status     text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','running','ready','failed')),
  receipt             text,
  result_ref          text,
  verification        text CHECK (verification IS NULL OR json_valid(verification)),
  idempotency_key     text        NOT NULL UNIQUE,
  error               text,
  created_at          text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT handoff_ready_has_receipt CHECK (delivery_status <> 'ready' OR receipt IS NOT NULL)
);

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

CREATE TABLE users (
  id                  text        PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  email               text        NOT NULL,
  name                text,
  password_hash       text        NOT NULL,
  project_context_id  text,
  created_at          text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT users_email_lower CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_idx ON users (email);

CREATE TABLE sessions (
  token_hash  text        PRIMARY KEY,
  user_id     text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  text NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE user_imports (
  user_id                  text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  unit_id                  text        NOT NULL REFERENCES ingested_units (id),
  project_context_id       text,
  project_context_version  integer,
  created_at               text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, unit_id),
  FOREIGN KEY (project_context_id, project_context_version) REFERENCES project_contexts (id, version)
);
CREATE INDEX user_imports_unit_idx ON user_imports (unit_id);

CREATE TABLE agent_briefs (
  id                text        PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  user_id           text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  skill_result_ids  text      NOT NULL CHECK (skill_result_ids IS NULL OR json_valid(skill_result_ids)),
  input_key         text        NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ready','failed')),
  claim_token       text,
  brief             text CHECK (brief IS NULL OR json_valid(brief)),
  prompts           text CHECK (prompts IS NULL OR json_valid(prompts)),
  prompt_revision   text,
  error             text,
  created_at        text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CONSTRAINT agent_brief_has_skills CHECK (json_array_length(skill_result_ids) >= 1),
  CONSTRAINT agent_brief_ready_has_prompts CHECK (status <> 'ready' OR prompts IS NOT NULL),
  UNIQUE (user_id, input_key)
);

CREATE INDEX ingested_units_claimed_at_idx ON ingested_units (claimed_at);
CREATE TABLE processing_starts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 unit_id TEXT NOT NULL REFERENCES ingested_units(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('extract','digest','retry','handoff')),
 charged INTEGER NOT NULL CHECK (charged IN (0,1)),
 batch_token TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX processing_starts_created_at_idx ON processing_starts(created_at);
CREATE INDEX processing_starts_unit_idx ON processing_starts(unit_id, created_at);
CREATE INDEX processing_starts_batch_idx ON processing_starts(batch_token);

CREATE TRIGGER artifacts_freeze_ready_revision BEFORE UPDATE ON artifacts
WHEN OLD.ingestion_status = 'ready' AND (NEW.id IS NOT OLD.id OR NEW.version IS NOT OLD.version OR NEW.name IS NOT OLD.name OR NEW.source_url IS NOT OLD.source_url OR NEW.source_ids IS NOT OLD.source_ids OR NEW.sources IS NOT OLD.sources OR NEW.raw_artifact_ref IS NOT OLD.raw_artifact_ref OR NEW.processed_text IS NOT OLD.processed_text OR NEW.category IS NOT OLD.category OR NEW.selection_reason IS NOT OLD.selection_reason OR NEW.evidence IS NOT OLD.evidence OR NEW.project_context_id IS NOT OLD.project_context_id OR NEW.project_context_version IS NOT OLD.project_context_version OR NEW.digestion_prompt_id IS NOT OLD.digestion_prompt_id)
BEGIN SELECT RAISE(ABORT,'ready artifact revision is immutable; insert a new version'); END;
