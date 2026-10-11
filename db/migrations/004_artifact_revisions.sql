-- Immutable artifact revisions (docs/project-actions-spec.md, "Workstream 2: input contract").
-- 001 made artifacts.id the primary key, so a new revision could not share an id. Downstream results
-- (video_results, skill_results) already reference (id, version); this makes that pair the identity and
-- freezes a revision's content once it is ready. A change to the material is a new row: same id, version + 1.
-- Status, review and error fields stay writable, and a pending/failed artifact may still be filled in.
-- Nothing references artifacts(id) alone (checked against 001-003). Not yet applied to TigerData.

BEGIN;

ALTER TABLE artifacts DROP CONSTRAINT artifacts_pkey;
ALTER TABLE artifacts ADD PRIMARY KEY (id, version);
ALTER TABLE artifacts ADD CONSTRAINT artifacts_version_positive CHECK (version >= 1);

CREATE FUNCTION artifacts_freeze_ready_revision() RETURNS trigger AS $$
BEGIN
  IF OLD.ingestion_status = 'ready' AND
     ROW(NEW.id, NEW.version, NEW.name, NEW.source_url, NEW.source_ids, NEW.sources, NEW.raw_artifact_ref,
         NEW.processed_text, NEW.category, NEW.selection_reason, NEW.evidence,
         NEW.project_context_id, NEW.project_context_version, NEW.digestion_prompt_id)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.version, OLD.name, OLD.source_url, OLD.source_ids, OLD.sources, OLD.raw_artifact_ref,
         OLD.processed_text, OLD.category, OLD.selection_reason, OLD.evidence,
         OLD.project_context_id, OLD.project_context_version, OLD.digestion_prompt_id)
  THEN
    RAISE EXCEPTION 'artifact % revision % is ready and immutable; insert version % instead', OLD.id, OLD.version, OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER artifacts_freeze_ready_revision
  BEFORE UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION artifacts_freeze_ready_revision();

COMMIT;
