# Ingestion (workflow 1)

Node-only. Extracts supplied YouTube videos with Gemini, then digests them with the Digestion Prompt. There is no
project: extraction and digests are shared, so a video imported by several users is read and digested once.
Mounted by `src/index.ts` at `/api/ingest` when `GEMINI_API_KEY` is set (and then `INGEST_TOKEN` is required, or startup fails).

| Route | Purpose |
| --- | --- |
| `POST /api/ingest/process` | The processor contract: `{ unit_ids }` -> `202`. Claims pending units, extracts them, digests ready units that have no digest yet. Safe to repeat. |
| `POST /api/ingest/imports`, `GET /api/ingest/imports/:id` | Dev tool: submit links directly and watch per-link state. Uses an in-memory job map. |

Every route needs `Authorization: Bearer $INGEST_TOKEN`. The web Worker sends its `PROCESSOR_TOKEN`, so set both to the same secret.

| Env | Meaning |
| --- | --- |
| `INGEST_TOKEN` | Bearer token callers must send. Required when ingestion is enabled. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Extraction. Model defaults to `gemini-3.5-flash-lite`. |
| `WINDOW_SECONDS` | Seconds extracted from each unit's start time (30-3600, default 300). |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Digestion. Without a key units are extracted but not digested. |
| `DIGESTION_REQUEST` | Categorization request stored with each Digestion Prompt revision. |
| `DATABASE_URL` | Postgres/TigerData. Enables the sweep; without it records stay in memory. |
| `SWEEP_INTERVAL_MS` | Pending-unit sweep interval (default 60000). |

Behavior: pending units are claimed atomically (`UPDATE ... WHERE status = 'pending'`); a `ready` unit is never re-extracted;
a unit is digested once (skipped when it already has a non-failed artifact or an exclusion); artifacts are written with
`project_context_id` null; a failed digest is stored as a failed artifact with its error and retried by the next request.
Migration `004_artifact_revisions.sql` makes `(id, version)` the artifact key and freezes a ready revision (not yet applied to TigerData).
