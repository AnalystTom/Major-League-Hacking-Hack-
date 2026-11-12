-- One row per new account, for daily sign-up caps. The IP is stored only as a SHA-256 hash.
CREATE TABLE signup_events (
  id INTEGER PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX signup_events_created ON signup_events(created_at);
CREATE INDEX signup_events_ip ON signup_events(ip_hash, created_at);
-- Per-account daily import counts read user_imports.created_at.
CREATE INDEX user_imports_user_created ON user_imports(user_id, created_at);
