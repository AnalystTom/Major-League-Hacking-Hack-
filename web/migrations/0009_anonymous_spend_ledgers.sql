ALTER TABLE video_starts RENAME TO video_starts_old;
CREATE TABLE video_starts (
  claim_token TEXT PRIMARY KEY,
  artifact_id TEXT,
  artifact_version INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (artifact_id,artifact_version) REFERENCES artifacts(id,version)
);
INSERT INTO video_starts(claim_token,artifact_id,artifact_version,created_at)
  SELECT claim_token,artifact_id,artifact_version,created_at FROM video_starts_old;
DROP TABLE video_starts_old;
CREATE INDEX video_starts_created_idx ON video_starts(created_at);

ALTER TABLE user_video_requests RENAME TO user_video_requests_old;
CREATE TABLE user_video_requests (
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  artifact_id TEXT,
  artifact_version INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (artifact_id,artifact_version) REFERENCES artifacts(id,version)
);
INSERT INTO user_video_requests(user_id,artifact_id,artifact_version,created_at)
  SELECT user_id,artifact_id,artifact_version,created_at FROM user_video_requests_old;
DROP TABLE user_video_requests_old;
CREATE UNIQUE INDEX user_video_requests_user_idx ON user_video_requests(user_id);
CREATE INDEX user_video_requests_created_idx ON user_video_requests(created_at);
CREATE INDEX user_video_requests_artifact_idx ON user_video_requests(artifact_id,artifact_version);

ALTER TABLE processing_starts RENAME TO processing_starts_old;
CREATE TABLE processing_starts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT REFERENCES ingested_units(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('extract','digest','retry','handoff')),
  charged INTEGER NOT NULL CHECK (charged IN (0,1)),
  batch_token TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO processing_starts(id,unit_id,kind,charged,batch_token,created_at)
  SELECT id,unit_id,kind,charged,batch_token,created_at FROM processing_starts_old;
DROP TABLE processing_starts_old;
CREATE INDEX processing_starts_created_at_idx ON processing_starts(created_at);
CREATE INDEX processing_starts_unit_idx ON processing_starts(unit_id, created_at);
CREATE INDEX processing_starts_batch_idx ON processing_starts(batch_token);

ALTER TABLE x_read_requests RENAME TO x_read_requests_old;
CREATE TABLE x_read_requests (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  user_key TEXT
);
INSERT INTO x_read_requests(id,day,user_key)
  SELECT id,day,user_key FROM x_read_requests_old;
DROP TABLE x_read_requests_old;
CREATE INDEX x_read_requests_day_user ON x_read_requests(day,user_key);
