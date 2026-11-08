-- Decisions belong to an account, never to a shared artifact globally.
CREATE TABLE user_skill_choices (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artifact_id text NOT NULL,
  artifact_version integer NOT NULL,
  kept integer NOT NULL CHECK (kept IN (0,1)),
  video_requested integer NOT NULL DEFAULT 0 CHECK (video_requested IN (0,1) AND video_requested <= kept),
  PRIMARY KEY (user_id, artifact_id, artifact_version),
  FOREIGN KEY (artifact_id, artifact_version) REFERENCES artifacts(id, version)
);
CREATE INDEX user_skill_choices_video_idx ON user_skill_choices(artifact_id,artifact_version)
  WHERE kept=1 AND video_requested=1;
