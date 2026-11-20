DROP TRIGGER artifacts_freeze_ready_revision;
CREATE TRIGGER artifacts_freeze_ready_revision BEFORE UPDATE ON artifacts
WHEN OLD.ingestion_status = 'ready' AND (
  NEW.id IS NOT OLD.id OR NEW.version IS NOT OLD.version OR NEW.name IS NOT OLD.name
  OR (NEW.source_ids IS NOT OLD.source_ids AND EXISTS (SELECT 1 FROM json_each(NEW.source_ids) n WHERE n.value NOT IN (SELECT o.value FROM json_each(OLD.source_ids) o)))
  OR (NEW.source_url IS NOT OLD.source_url AND NEW.source_ids IS OLD.source_ids)
  OR NEW.sources IS NOT OLD.sources OR NEW.raw_artifact_ref IS NOT OLD.raw_artifact_ref OR NEW.processed_text IS NOT OLD.processed_text OR NEW.category IS NOT OLD.category OR NEW.selection_reason IS NOT OLD.selection_reason OR NEW.evidence IS NOT OLD.evidence OR NEW.project_context_id IS NOT OLD.project_context_id OR NEW.project_context_version IS NOT OLD.project_context_version OR NEW.digestion_prompt_id IS NOT OLD.digestion_prompt_id)
BEGIN SELECT RAISE(ABORT,'ready artifact revision is immutable; insert a new version'); END;
