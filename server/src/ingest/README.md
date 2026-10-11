# Ingestion (workflow 1)

Node-only. Extracts supplied YouTube videos with Gemini, then digests them for a project with the Digestion Prompt.
Mounted by `src/index.ts` at `/api/ingest` only when `GEMINI_API_KEY` **and** `PROCESSOR_TOKEN` are set.

| Route | Purpose |
| --- | --- |
| `POST /api/ingest/process` | The processor contract: `{ unit_ids, project }` -> `202`. Claims pending units, extracts them, digests ready units for the project. Safe to repeat. |
| `POST /api/ingest/imports`, `GET /api/ingest/imports/:id` | Dev tool: submit links directly and watch per-link state. Uses an in-memory job map and the placeholder project. |

Every route needs `Authorization: Bearer $PROCESSOR_TOKEN` (the same token the web Worker sends).

| Env | Meaning |
| --- | --- |
| `PROCESSOR_TOKEN` | Bearer token callers must send. Required. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Extraction. Model defaults to `gemini-3.5-flash-lite`. |
| `WINDOW_SECONDS` | Seconds extracted from each unit's start time (30-3600, default 300). |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Digestion. Without a key units are extracted but not digested. |
| `DIGESTION_REQUEST` | Categorization request stored with each Digestion Prompt revision. |
| `DATABASE_URL` | Postgres/TigerData. Enables the sweep; without it records stay in memory. |
| `SWEEP_INTERVAL_MS` | Pending-unit sweep interval (default 60000). |
| `PROJECT_CONTEXT` | Placeholder project JSON for the dev route and CLI. |

Behavior: pending units are claimed atomically (`UPDATE ... WHERE status = 'pending'`); a `ready` unit is never re-extracted;
a unit is digested once per project id + version; a failed digest is stored as a failed artifact with its error and retried
by the next request. Migrations `004_artifact_revisions.sql` makes `(id, version)` the artifact key and freezes a ready revision.
