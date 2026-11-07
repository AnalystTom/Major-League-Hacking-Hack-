-- One row per provider call (server/src/usage.ts), so cost per processed item comes from production usage.
CREATE TABLE usage_events (
  id               integer PRIMARY KEY,
  step             text NOT NULL,
  provider         text NOT NULL,
  model            text NOT NULL,
  input_tokens     integer,
  output_tokens    integer,
  reasoning_tokens integer,
  ref              text,
  created_at       text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX usage_events_created ON usage_events (created_at);
