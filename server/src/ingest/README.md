# Ingestion (workflow 1)

Node-only. Extracts supplied YouTube videos, X posts (bookmarked post links) and public Substack posts using the providers configured below, then digests them with the Digestion Prompt. There is no
project: extraction is shared. Digest sharing and per-user visibility follow [Who sees what](../../../docs/proceed-and-media.md#who-sees-what).
Mounted by `src/index.ts` at `/api/ingest` when `GEMINI_API_KEY` is set (and then `INGEST_TOKEN` is required, or startup fails).

| Route | Purpose |
| --- | --- |
| `POST /api/ingest/process` | The processor contract: `{ unit_ids }` -> `202`. Claims pending units, extracts them, digests ready units that have no digest yet. Safe to repeat. |
| `POST /api/ingest/imports`, `GET /api/ingest/imports/:id` | Mounted only with `ENABLE_DEV_IMPORTS=1`. Dev tool: submit links directly and watch per-link state. Uses an in-memory job map. |

Every route needs `Authorization: Bearer $INGEST_TOKEN`. The web Worker sends its `PROCESSOR_TOKEN`, so set both to the same secret.

| Env | Meaning |
| --- | --- |
| `INGEST_TOKEN` | Bearer token callers must send. Required when ingestion is enabled. |
| `TWITTERAPI_IO_KEY` | Optional [twitterapi.io](https://twitterapi.io) key for reading X post text without a model. Link-only posts also query its Article endpoint for the full body. When a keyed read has no article, X's public embed endpoint (`cdn.syndication.twimg.com`, no key) is checked for an Article title and preview to supplement the keyed text and quotes. If that supplementary lookup fails, the keyed text is still usable. Without a key, or when keyed extraction fails, the public endpoint reads the post instead, with Article title and preview only. |
| `NIMBLE_API_KEY` | [Nimble](https://docs.nimbleway.com) key, used to read public Substack posts (`ingested_units.content_type = 'substack_post'`). Without it Substack units fail with "NIMBLE_API_KEY is not configured". |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Extraction. Model defaults to `gemini-3.5-flash-lite`. |
| `WINDOW_SECONDS` | Seconds extracted from each unit's start time (30-3600, default 3600, i.e. 1 hour). |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Digests, skills, scripts and the short-quality judge use the OpenAI API at `https://api.openai.com/v1`. Without a key units are extracted but not digested. `OPENAI_MODEL` overrides the model for all of them. When unset, digests and skills use `DEFAULT_DIGEST_MODEL` in [`digest/run.ts`](digest/run.ts); scripts and the judge use `gpt-6.1-sol` via [`shortModel`](../outputs/render/script.ts). Deployment configuration lives in [`deploy/processor/wrangler.jsonc`](../../../deploy/processor/wrangler.jsonc). |
| `OPENAI_MAX_OUTPUT_TOKENS` | Digest and generated-output cap including reasoning tokens; its fallback is `DEFAULT_MAX_OUTPUT_TOKENS` in [`digest/run.ts`](digest/run.ts). Raise it if digests report hitting the cap. |
| `OPENAI_REASONING_EFFORT` | Optional reasoning effort for digests, skills and handoffs. Unset uses the model's default; accepted values are defined in [`openaiEffort.ts`](../openaiEffort.ts). Shorts use the separate settings below. |
| `SCRIPT_REASONING_EFFORT` | Script generation and its bounded revision; defaults to `medium`. Overrides the shared effort for these calls; accepted values are the same as above. |
| `JUDGE_REASONING_EFFORT` | Each independent short-quality review; defaults to `high`. Overrides the shared effort for these calls; accepted values are the same as above. |
| `DIGESTION_REQUEST` | Categorization request stored with each Digestion Prompt revision. |
| `D1_URL`, `D1_TOKEN` | Authenticated processor Worker D1 bridge. Enables the sweep; without both, ephemeral CLI runs use memory. |
| `SWEEP_INTERVAL_MS` | Pending-unit sweep interval (default 60000). |

Digest calls, including validation retries, request reproducible sampling with the fixed seed in
[`digest/run.ts`](digest/run.ts). This leaves the reasoning-effort setting above unchanged.

Behavior: pending units are claimed atomically (`UPDATE ... WHERE status = 'pending'`); a `ready` unit is never re-extracted;
artifacts are written with
`project_context_id` null; a failed digest is stored as a failed artifact with its error and retried by the next request.
Content selection follows the [Digestion Prompt rules](../../../docs/project-actions-spec.md#filtering-and-digestion-prompt).
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
