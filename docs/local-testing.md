# Local product and pipeline testing

Run `npm.cmd ci --prefix web`, `npm.cmd ci --prefix server`, and
`npm.cmd ci --prefix packages/motion-shorts` after checkout. Then run:

```powershell
node scripts/setup-local.mjs
```

This preserves existing values, generates matching processor tokens if absent,
copies database/processor configuration into `web/.dev.vars`, and installs the
x64 workerd binary under Windows ARM emulation when necessary. It prints no
credentials. Rerun it after changing `DATABASE_URL` in `.env.local`. The root
configuration is authoritative for frontend database and processor settings;
those three values are synchronized into `web/.dev.vars` on each run.

## Required access

Set these in the repository `.env.local` (never paste secrets in source files):

- `DATABASE_URL`: development PostgreSQL/TigerData connection. The integrated
  application requires migrations `001` through `009` in order, only if not already applied.
  Run `npm.cmd run motion --prefix packages/motion-shorts -- database` for a live,
  read-only readiness check. For separate `TIGER_DATA_*` service settings, add
  `--configure-tiger` to verify them and synchronize the ignored local connection files.
- `GEMINI_API_KEY`: source-video extraction.
- `OPENAI_API_KEY` and `OPENAI_MODEL`: digest, creative generation, and speech.
- For cloud delivery only: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, scoped to the media bucket. Local testing does not
  require these. `R2_BUCKET` defaults to `resurface-media` in setup.
  The equivalent `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_KEY_ID`, and
  `CLOUDFLARE_SECRET_ACCESS_KEY` names are also accepted. Explicit `R2_*`
  values take precedence. `CLOUDFLARE_API_TOKEN` is a separate management token;
  it does not replace the S3 access key and secret.

`TWITTER_API_KEY` and `TWITTER_API_SECRET` are reserved for X integration.
They do not enable X imports: the current importer accepts YouTube links only.
Personal bookmarks additionally require user authorization. `motion doctor`
reports app-key presence and this unsupported state without printing credentials.

The worker supplies a synthesized music bed with recorded provenance. An optional
custom `MOTION_MUSIC_FILE` requires `MOTION_MUSIC_PROVENANCE` identifying its
source and permission to use it. Speech defaults to the OpenAI `coral` voice,
and production videos visibly disclose AI-generated voice.

## Start the services in separate terminals

```powershell
# Repository root: extraction and digestion, port 3000
npm.cmd run dev --prefix server

# Repository root: frontend, port 8787
npm.cmd run dev --prefix web -- --port 8787

# packages/motion-shorts: rendering and delivery worker
npm.cmd run motion -- doctor
npm.cmd run motion -- worker
```

Open `http://127.0.0.1:8787/start`. The normal product config is needed;
`deploy:waitlist` deliberately excludes onboarding and product APIs.

The worker polls ready artifacts, takes a per-revision PostgreSQL advisory lock,
generates and validates media, synthesizes speech and music, then uploads to R2.
Every upload is read back and compared against the local SHA-256 before a
`video_results` row becomes `ready`. No manual approval is invented or required
by the shared feed. Failed jobs retain their real error and do not retry forever.
Use `motion worker --once --retry-failed` for an explicit bounded retry. Local
stage caches preserve completed work. If a process is forcibly killed, inspect
its local `worker.lock` and remove it only after verifying its PID has exited.

Creative OpenAI requests use `OPENAI_TIMEOUT_MS=900000` (15 minutes) by default.
The SDK deadline and the HTTP header/body waits use the same limit so Node's
shorter default cannot interrupt long reasoning requests. Values must be integer
milliseconds from 1000 to 1800000. The model and reasoning effort are preserved;
API errors are not automatically retried. Cached completed stages are reused on
an explicit retry.

Setup selects `MOTION_MEDIA_STORAGE=local`: uploads go to the same persistent
local R2 store used by the frontend, are downloaded again for checksum checks,
and can be played without Cloudflare credentials. The verified development
fixture is at `/media/videos/dev/simulation/short.mp4`; it is not inserted into
the real feed. Select `MOTION_MEDIA_STORAGE=r2` for cloud delivery and configure
the credentials above. Pair cloud delivery with the matching deployed development
frontend or remote R2 binding; local and cloud buckets are separate.

## Verified boundary

The Windows ARM frontend runtime starts and loads the real pages. Local R2
upload/readback, frontend byte-range serving, a 1080x1920 H.264/AAC fixture,
and a live OpenAI speech response were verified. Live database connectivity and
Cloudflare R2 write/readback were also verified on October 11, 2026; the temporary
cloud diagnostic object was removed. The local app still uses local R2.
Without
`DATABASE_URL`, onboarding accurately returns 503; account creation cannot be
tested successfully. Unit tests cover locking, idempotency, failure persistence,
evidence mapping, upload corruption, and delivery gates. On October 11, 2026,
the previously failed sourced artifact completed after the creative deadline fix:
animation generation took about 211 seconds, followed by speech, production
rendering, media validation and local R2 readback. The 36-second 1080x1920,
30 fps H.264/AAC result reached database status `ready` and played in a headless
browser through the frontend. Evidence is in
`packages/motion-shorts/artifacts/clip-a036e6f14161046e42d55740/qa.json` and
`playback-qa.json`. This reused the existing ingested artifact; source ingestion
was not rerun. Artistic quality and narration/caption alignment still need review.

`packages/motion-shorts/scripts/verify-frontend.mjs` checks the running frontend
in an isolated headless browser. When a database is connected it creates a
clearly named test account; use a development database. Evidence is saved under
`packages/motion-shorts/artifacts/frontend-qa/`.

## Fast generation (default)

`MOTION_GENERATION_MODE=fast` is the default worker path. It uses the existing
backend digest, one compact three-beat script request with low reasoning effort,
three parallel speech requests, three designed 1080x1920 scenes, and FFmpeg
encoding. It preserves evidence references, checks text fit and decoded media,
and verifies upload bytes before marking the result ready. Local R2 writes are
sequential because concurrent Wrangler writes can conflict.

A fresh production run was measured at 25.5 seconds including delivery on this
machine. This excludes source extraction and queue wait and is a measured run,
not a provider latency guarantee. The older geometry/Remotion path remains
available with `MOTION_GENERATION_MODE=creative`. Existing ready clips are kept.

For a local preview without changing database state:
`npm.cmd run motion -- fast path/to/sourced-input.json`. `--upload` also delivers
the media, but only the worker transitions a database result to ready.
