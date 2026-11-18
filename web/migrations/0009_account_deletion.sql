CREATE TABLE user_imports_next (
  user_id                  text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  unit_id                  text        NOT NULL REFERENCES ingested_units (id) ON DELETE CASCADE,
  project_context_id       text,
  project_context_version  integer,
  created_at               text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, unit_id),
  FOREIGN KEY (project_context_id, project_context_version) REFERENCES project_contexts (id, version)
);
INSERT INTO user_imports_next (user_id, unit_id, project_context_id, project_context_version, created_at)
  SELECT user_id, unit_id, project_context_id, project_context_version, created_at FROM user_imports;
DROP TABLE user_imports;
ALTER TABLE user_imports_next RENAME TO user_imports;
CREATE INDEX user_imports_unit_idx ON user_imports (unit_id);
CREATE INDEX user_imports_user_created ON user_imports (user_id, created_at);

DROP TRIGGER artifacts_freeze_ready_revision;
CREATE TRIGGER artifacts_freeze_ready_revision BEFORE UPDATE ON artifacts
WHEN OLD.ingestion_status = 'ready' AND (NEW.id IS NOT OLD.id OR NEW.version IS NOT OLD.version OR NEW.name IS NOT OLD.name OR NEW.sources IS NOT OLD.sources OR NEW.raw_artifact_ref IS NOT OLD.raw_artifact_ref OR NEW.processed_text IS NOT OLD.processed_text OR NEW.category IS NOT OLD.category OR NEW.selection_reason IS NOT OLD.selection_reason OR NEW.evidence IS NOT OLD.evidence OR NEW.project_context_id IS NOT OLD.project_context_id OR NEW.project_context_version IS NOT OLD.project_context_version OR NEW.digestion_prompt_id IS NOT OLD.digestion_prompt_id
  OR (NEW.source_ids IS NOT OLD.source_ids AND EXISTS (SELECT 1 FROM json_each(NEW.source_ids) added WHERE added.value NOT IN (SELECT value FROM json_each(OLD.source_ids))))
  OR (NEW.source_url IS NOT OLD.source_url AND NEW.source_ids IS OLD.source_ids))
BEGIN SELECT RAISE(ABORT,'ready artifact revision is immutable; insert a new version'); END;
