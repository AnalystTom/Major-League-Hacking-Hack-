CREATE TABLE video_rejection_releases (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL,
  artifact_version INTEGER NOT NULL,
  claim_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (artifact_id,artifact_version) REFERENCES artifacts(id,version)
);
