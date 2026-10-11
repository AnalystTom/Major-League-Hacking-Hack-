# Ingestion (workflow 1)

Node-only. Extracts supplied YouTube videos with Gemini and public Substack posts with Nimble, then digests them with the Digestion Prompt. There is no
project: extraction and digests are shared, so a video or post imported by several users is read and digested once.
Mounted by `src/index.ts` at `/api/ingest` when `GEMINI_API_KEY` is set (and then `INGEST_TOKEN` is required, or startup fails).

| Route | Purpose |
| --- | --- |
| `POST /api/ingest/process` | The processor contract: `{ unit_ids }` -> `202`. Claims pending units, extracts them, digests ready units that have no digest yet. Safe to repeat. |
| `POST /api/ingest/imports`, `GET /api/ingest/imports/:id` | Dev tool: submit links directly and watch per-link state. Uses an in-memory job map. |

Every route needs `Authorization: Bearer $INGEST_TOKEN`. The web Worker sends its `PROCESSOR_TOKEN`, so set both to the same secret.

| Env | Meaning |
| --- | --- |
| `INGEST_TOKEN` | Bearer token callers must send. Required when ingestion is enabled. |
| `NIMBLE_API_KEY` | Substack extraction (`POST https://sdk.nimbleway.com/v2/extract`, markdown). Without it Substack units fail with "NIMBLE_API_KEY not configured". |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Extraction. Model defaults to `gemini-3.5-flash-lite`. |
| `WINDOW_SECONDS` | Seconds extracted from each unit's start time (30-3600, default 3600, i.e. 1 hour). |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Digestion. Without a key units are extracted but not digested. |
| `OPENAI_MAX_OUTPUT_TOKENS` | Digest output cap including reasoning tokens (default 20000). Raise it if digests report hitting the cap. |
| `DIGESTION_REQUEST` | Categorization request stored with each Digestion Prompt revision. |
| `DATABASE_URL` | Postgres/TigerData. Enables the sweep; without it records stay in memory. |
| `SWEEP_INTERVAL_MS` | Pending-unit sweep interval (default 60000). |

Behavior: pending units are claimed atomically (`UPDATE ... WHERE status = 'pending'`); a `ready` unit is never re-extracted;
a unit is digested once (skipped when it already has a non-failed artifact or an exclusion); artifacts are written with
`project_context_id` null; a failed digest is stored as a failed artifact with its error and retried by the next request.
Migration `004_artifact_revisions.sql` makes `(id, version)` the artifact key and freezes a ready revision (not yet applied to TigerData).

## Substack posts

Only public `https://<publication>.substack.com/p/<slug>` links (and `open.substack.com/pub/<publication>/p/<slug>`) are recognized; tracking
params are dropped and the canonical post URL is the unit's `source_url`. Custom-domain newsletters and `substack.com/@user` / app share links
are rejected with a message asking for the post address. Units are stored with `content_type = 'substack_post'`.

Nimble returns the rendered page as markdown; the post body (from the first `#` heading to the comments section) is split into numbered
`sections` in `ingested_units.transcript` (`{ sections: [{ index, text }] }`, at most 80 sections of 1,500 characters). Digests cite a post by
`evidence[].section` instead of timestamps, and `validateDigest` requires that section to exist. A paywalled post, an empty page, a non-2xx page
status, or a Nimble failure makes the unit `failed` with the actual reason; nothing is inferred from a paywall teaser. No schema migration is needed.
