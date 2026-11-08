-- Preserve completed imports and their identities across reconnects.
ALTER TABLE x_connections ADD COLUMN initial_complete INTEGER NOT NULL DEFAULT 0;
ALTER TABLE x_connections ADD COLUMN last_seen_id TEXT;
ALTER TABLE x_connections ADD COLUMN head_id TEXT;
ALTER TABLE x_connections ADD COLUMN refresh_token TEXT;
UPDATE x_connections SET initial_complete=1 WHERE import_state='complete' OR read_count>=50;
UPDATE x_connections SET import_state='complete',cursor=NULL WHERE read_count>=50 AND import_state!='disconnected';
CREATE TABLE x_seen_bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  PRIMARY KEY(user_id,post_id)
);
INSERT OR IGNORE INTO x_seen_bookmarks(user_id,post_id)
SELECT i.user_id,substr(u.source_url,instr(u.source_url,'/status/')+8)
FROM user_imports i JOIN ingested_units u ON u.id=i.unit_id
WHERE u.source_url LIKE 'https://x.com/%/status/%';
-- A single conditional INSERT reserves a read before any paid request.
CREATE TABLE x_read_requests (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  user_key TEXT NOT NULL
);
CREATE INDEX x_read_requests_day_user ON x_read_requests(day,user_key);
