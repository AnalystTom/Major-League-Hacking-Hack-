-- Accounts and onboarding (docs/proceed-and-media.md). Additive only: no existing table changes.
-- A user owns a project brief (project_contexts) and the links they imported. Ingested units stay
-- shared, so two people importing the same video reuse one unit; user_imports records who asked.

BEGIN;

CREATE TABLE users (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text        NOT NULL,
  name                text,
  password_hash       text        NOT NULL,          -- pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>
  project_context_id  uuid,                          -- current brief; its newest version is current
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_idx ON users (email);

-- Only a SHA-256 of the cookie token is stored, so a database read can't be replayed as a login.
CREATE TABLE sessions (
  token_hash  text        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE user_imports (
  user_id                  uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  unit_id                  uuid        NOT NULL REFERENCES ingested_units (id),
  project_context_id       uuid,
  project_context_version  integer,
  created_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, unit_id),
  FOREIGN KEY (project_context_id, project_context_version) REFERENCES project_contexts (id, version)
);
CREATE INDEX user_imports_unit_idx ON user_imports (unit_id);

COMMIT;
