-- OAuth identities are linked only by X user ID or an already-authenticated local session.
CREATE TABLE x_oauth_attempts (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE x_connections (
  x_user_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  access_token TEXT,
  expires_at INTEGER NOT NULL,
  cursor TEXT,
  read_count INTEGER NOT NULL DEFAULT 0,
  import_state TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT
);
