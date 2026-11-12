-- A lifetime slot belongs to an account; failures/reconnects cannot allocate another video.
CREATE TABLE user_video_requests (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL,
  artifact_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (artifact_id,artifact_version) REFERENCES artifacts(id,version)
);
CREATE INDEX user_video_requests_created_idx ON user_video_requests(created_at);
CREATE INDEX user_video_requests_artifact_idx ON user_video_requests(artifact_id,artifact_version);

-- Preserve existing allocations, preferring a finished video, without deleting any media.
-- A failed video never uses the slot: only a successful (or still queued/running) one does.
INSERT INTO user_video_requests(user_id,artifact_id,artifact_version,created_at)
SELECT user_id,artifact_id,artifact_version,created_at FROM (
  SELECT u.id AS user_id,a.id AS artifact_id,a.version AS artifact_version,a.created_at,
    row_number() OVER (PARTITION BY u.id ORDER BY v.status='ready' DESC,a.created_at,a.id,a.version DESC) AS position
  FROM user_imports owner JOIN artifacts a ON owner.unit_id=json_extract(a.source_ids,'$[0]')
  JOIN users u ON u.id=owner.user_id
    AND NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) src
      WHERE NOT EXISTS (SELECT 1 FROM user_imports ui WHERE ui.user_id=u.id AND ui.unit_id=src.value))
  LEFT JOIN user_skill_choices c ON c.user_id=u.id AND c.artifact_id=a.id AND c.artifact_version=a.version
  LEFT JOIN video_results v ON v.artifact_id=a.id AND v.artifact_version=a.version
  WHERE (c.video_requested=1 OR v.attempts>0 OR v.status IN ('ready','running')) AND v.status IS NOT 'failed'
) WHERE position=1;
UPDATE user_skill_choices SET video_requested=0 WHERE video_requested=1 AND NOT EXISTS (
  SELECT 1 FROM user_video_requests r WHERE r.user_id=user_skill_choices.user_id
    AND r.artifact_id=user_skill_choices.artifact_id AND r.artifact_version=user_skill_choices.artifact_version
);

-- Every actual video claim, including first attempts and retries, reserves a daily/monthly slot.
CREATE TABLE video_starts (
  claim_token TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  artifact_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (artifact_id,artifact_version) REFERENCES artifacts(id,version)
);
CREATE INDEX video_starts_created_idx ON video_starts(created_at);
