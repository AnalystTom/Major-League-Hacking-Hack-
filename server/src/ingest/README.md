# Ingestion (workflow 1)

Node-only. Extracts supplied YouTube videos with Gemini and X posts (bookmarked post links) from twitterapi.io and public Substack posts with Nimble, then digests them with the Digestion Prompt. There is no
project: extraction and digests are shared, so a video imported by several users is read and digested once.
Mounted by `src/index.ts` at `/api/ingest` when `GEMINI_API_KEY` is set (and then `INGEST_TOKEN` is required, or startup fails).

| Route | Purpose |
| --- | --- |
| `POST /api/ingest/process` | The processor contract: `{ unit_ids }` -> `202`. Claims pending units, extracts them, digests ready units that have no digest yet. Safe to repeat. |
| `POST /api/ingest/imports`, `GET /api/ingest/imports/:id` | Mounted only with `ENABLE_DEV_IMPORTS=1`. Dev tool: submit links directly and watch per-link state. Uses an in-memory job map. |

Every route needs `Authorization: Bearer $INGEST_TOKEN`. The web Worker sends its `PROCESSOR_TOKEN`, so set both to the same secret.

| Env | Meaning |
| --- | --- |
| `INGEST_TOKEN` | Bearer token callers must send. Required when ingestion is enabled. |
| `TWITTERAPI_IO_KEY` | [twitterapi.io](https://twitterapi.io) API key, used to read X posts (`ingested_units.content_type = 'x_post'`). Without it X units fail with "TWITTERAPI_IO_KEY is not configured". |
| `NIMBLE_API_KEY` | [Nimble](https://docs.nimbleway.com) key, used to read public Substack posts (`ingested_units.content_type = 'substack_post'`). Without it Substack units fail with "NIMBLE_API_KEY is not configured". |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Extraction. Model defaults to `gemini-3.5-flash-lite`. |
| `WINDOW_SECONDS` | Seconds extracted from each unit's start time (30-3600, default 3600, i.e. 1 hour). |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Digestion. Without a key units are extracted but not digested. |
| `OPENAI_MAX_OUTPUT_TOKENS` | Digest output cap including reasoning tokens (default 20000). Raise it if digests report hitting the cap. |
| `DIGESTION_REQUEST` | Categorization request stored with each Digestion Prompt revision. |
| `D1_URL`, `D1_TOKEN` | Authenticated processor Worker D1 bridge. Enables the sweep; without both, ephemeral CLI runs use memory. |
| `SWEEP_INTERVAL_MS` | Pending-unit sweep interval (default 60000). |

Behavior: pending units are claimed atomically (`UPDATE ... WHERE status = 'pending'`); a `ready` unit is never re-extracted;
a unit is digested once (skipped when it already has a non-failed artifact or an exclusion); artifacts are written with
`project_context_id` null; a failed digest is stored as a failed artifact with its error and retried by the next request.
The D1 schema in `web/migrations/0002_application.sql` makes `(id, version)` the artifact key and freezes a ready revision.

## Substack posts

Only public `https://<publication>.substack.com/p/<slug>` links (and `open.substack.com/pub/<publication>/p/<slug>`) are recognized; tracking
params are dropped and the canonical post URL is the unit's `source_url`. Custom-domain newsletters and `substack.com/@user` / app share links
are rejected with a message asking for the post address.

Nimble (`POST https://sdk.nimbleway.com/v2/extract`, `render: true`, markdown plus a CSS-selector `parser`, see `SUBSTACK_PARSER`) returns the rendered page.
The parser supplies the post title, subtitle, author, the body blocks (`div.available-content div.body.markup > *`) and a `div.paywall` marker. The body
becomes numbered `sections` in `ingested_units.transcript` (`{ overview?, sections: [{ index, text }] }`, at most 80 sections of 1,500 characters), as
plain text: links, images, emphasis markers, buttons and counters are removed. If a selector returns nothing (Substack changed its markup), the cleaned
markdown is used instead: the publication logo heading is skipped, the post's own `#` heading is the title, and the byline and comments are dropped.
Unlike videos and X posts, which cite `start_seconds`/`end_seconds` (X posts at second 0), digests cite a post by `evidence[].section`,
and `validateDigest` requires that section to exist. Any paywall signal (the parser marker, or "This post is for paid subscribers" and similar text)
makes the unit `failed`, however long the free preview is. An empty page, a non-2xx page status, or a Nimble failure also fails the unit with the actual
reason; nothing is inferred from a paywall teaser. No schema migration is needed (`content_type` is free text).
