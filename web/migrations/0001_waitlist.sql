CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  agent TEXT,
  sources TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
