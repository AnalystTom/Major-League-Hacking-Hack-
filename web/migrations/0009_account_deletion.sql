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
