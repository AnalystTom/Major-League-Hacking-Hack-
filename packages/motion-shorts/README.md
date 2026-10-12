# Motion Shorts

The worker defaults to `MOTION_GENERATION_MODE=editorial`: source-specific shot design, explicit coverage of backend content and caveats, an independent model audit, narrated animation, and verified delivery. Inspect `direction.json`, `coverage.json`, `layout.json`, and `qa.json` in the film artifact directory. The audit is a safeguard, not proof of factual completeness beyond the supplied text/evidence.

Run `npm.cmd run motion -- editorial <sourced-input.json>` for a local pilot. `--upload` uploads without changing database readiness. Set `fast` for the legacy three-beat format or `creative` for the original pipeline. Editorial generation is not yet reliably under one minute; do not describe cached rerenders as cold performance.

## PR #2 integration

PR #2 (`181c426`) supplies the frontend in `web/`, ingestion in `server/`,
and the shared TigerData schema. This package is the downstream renderer.

`npm.cmd run motion -- artifact bundle.json --prepare-only` validates a JSON
bundle `{ "artifact": <StoredArtifact>, "units": <ingested_units rows> }`,
persists the input, and records versioned R2 upload targets without AI calls.
Units must include `id`, `source_url`, `title` (nullable), and `status`.
Omit `--prepare-only` to generate and render at 1080x1920.

The adapter preserves artifact/project revisions and timestamped evidence.
It resolves source IDs through unit records because the artifact's `sources`
array has no IDs and must not be matched by position. Ready source-backed
artifacts can render with `review_status: pending`, as PR #2 requires; this
does not fabricate an approval. The older local `approve/publish` commands
are a separate legacy workflow, not the shared frontend's readiness gates.

The worker now polls ready artifacts, generates narration and procedural music,
verifies R2 uploads, and writes video_results. Run `motion worker` after
configuration. Failed jobs require an explicit bounded retry. See
[local testing](../../docs/local-testing.md) for credentials, startup, and verified limits.

Run commands from `packages/motion-shorts` using Node 22 or newer.
On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

The CLI loads `.env.local` from this package and the repository root, regardless
of the launch directory. Existing shell variables take priority, then package
settings, then repository settings. Keys are never printed by the loader.
See `.env.example` for configuration. When both provider keys exist, OpenAI wins.

Before starting a new iteration, run `npm.cmd run motion -- database` to check
the live connection, TLS, application tables, revision trigger and output keys.
This checks the schema required by migrations 001-009; it never applies migrations.
If using `TIGER_DATA_SERVICE_URL`, `TIGER_DATA_USERNAME`, `TIGER_DATA_PASSWORD`
and `TIGER_DATA_DATABASE_NAME`, run `npm.cmd run motion -- database --configure-tiger`.
Only a successful connection and schema check synchronizes `DATABASE_URL` into
the ignored root `.env.local` and `web/.dev.vars`; existing provider settings stay intact.
Tiger API keys do not replace the database password. Connection details are never printed.
`OPENAI_MODEL` is sent unchanged; there is no silent model fallback.
Set `OPENAI_REASONING_EFFORT=high` for high reasoning with GPT-6.1 Sol.

```powershell
npm.cmd run motion -- generate preview-input.json --preview-resolution
npm.cmd run motion -- brief preview-input.json
npm.cmd run motion -- status <job-id>
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
```

`preview-input.json` is a development example without verified evidence. It
produces a labeled, silent preview and cannot be published. The older
`test-input.json` contains placeholder sourcing and an unverified numerical
claim; do not use it as reviewed evidence.

Generation stores the brief, script, strategy, animation, and provider provenance
under `artifacts/<job-id>`. Repeating the same command resumes cached stages.
Successful rendering adds `video.mp4`, sampled frames, captions, and `qa.json`,
and leaves the local job `awaiting_review`. The legacy `publish` command requires
explicit human review. The shared worker instead uses processing readiness,
verified audio/media, and source-backed input, matching the current frontend.

The renderer requires a Chromium browser plus FFmpeg/FFprobe. Windows defaults
to Edge; `MOTION_BROWSER`, `FFMPEG_PATH`, and `FFPROBE_PATH` can override paths.
Only the OpenAI path is being live-verified in this handoff; Anthropic remains
unverified.
