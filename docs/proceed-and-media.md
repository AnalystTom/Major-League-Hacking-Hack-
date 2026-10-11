# Onboarding, processing, and where shorts live

The landing page's **Get started** button opens `/start`, a three-step onboarding with no setup:

1. **Account**: email and password, stored in TigerData (`users`, `sessions`; `db/migrations/002_accounts.sql`).
2. **Your videos**: up to 10 YouTube links, straight after sign-up. Stored as `ingested_units` and linked to
   the user in `user_imports`.
3. **Processing**: each link's real stage, then `/app`, the signed-in home with the user's links and reel.

Leaving part-way resumes at the first unfinished step. Signed-in visitors see "Open your feed" on the landing page.
A project brief (`PUT /api/project`) is optional and has no screen yet. Without one, digests are generic
(`project_context_id` null) and shared by everyone who imports the same video.

```
Browser ──POST /api/auth/signup──▶ Worker ──INSERT users, sessions──▶ TigerData   (httpOnly cookie back)
        ──POST /api/imports──▶ Worker ──INSERT ingested_units, user_imports──▶ TigerData
                                  └──POST PROCESSOR_URL {unit_ids, project}──▶ Processor
Processor: Gemini extraction → Digestion Prompt against the project → artifacts → Opus script → render
           ──PUT mp4 + vtt──▶ R2 (resurface-media)   ──UPDATE/INSERT──▶ TigerData
Browser ──GET /api/imports, /api/feed?scope=mine (every 4 s while processing)──▶ Worker ──▶ TigerData
        ──GET /media/videos/…mp4 (Range)──▶ Worker ──▶ R2
```

## Endpoints (web Worker, same origin as the page)

Every mutation must be `application/json`; with the `SameSite=Lax` session cookie that blocks cross-site forms.

| Route | Does |
| --- | --- |
| `POST /api/auth/signup` `{ email, password, name? }` | Creates the account (password ≥ 10 chars, PBKDF2-SHA256, 100k iterations) and signs in. `409` if the email is taken. |
| `POST /api/auth/login` `{ email, password }` | Signs in. Wrong password and unknown email get the same `401`. |
| `POST /api/auth/logout` | Ends the session. |
| `GET /api/me` | `{ user, project, imports, step }`, where `step` is `sources` or `done`; `{ user: null, step: "account" }` when signed out. |
| `PUT /api/project` `{ name, goal?, tools, agents }` | Optional, no screen yet: saves the next version of the user's brief. |
| `POST /api/imports` `{ links }` | Canonicalises links, reuses a non-failed unit for the same video and start time, links each to the user, and sends units new to this user to the processor (with the brief, or `project: null`). Returns `{ units, processor }`. |
| `GET /api/imports` | The user's links with their stage: `queued`, `fetching`, `digesting`, `rendering`, `ready`, `failed`, `render_failed`, `not_selected`, plus the actual error. |
| `GET /api/feed?scope=mine` | The user's shorts: artifacts for their project (or generic ones without a project) whose artifact and video are both `ready`. |
| `GET /api/feed` | The public curated feed (needs `feed_order`); no account. |
| `GET /media/<key>` | Streams `videos/`, `captions/` or `posters/` objects from R2 with byte ranges (Safari and seeking need them). |

Rate limits: sign-up and sign-in 10 per IP per minute (`AUTH_LIMITER`), imports 5 per account per minute (`IMPORT_LIMITER`).

## What the processor must do

It receives `POST PROCESSOR_URL` with `Authorization: Bearer PROCESSOR_TOKEN` and
`{ "unit_ids": [...], "project": { "id", "version", "name", "goal", "tools", "agents" } }`. `project` is null
for users who haven't given a brief: digest generically and leave `project_context_id` null.
Reply `202` quickly and work asynchronously. The same id can arrive twice, so be idempotent.
A unit is sent the first time a user imports it; resubmitting doesn't resend it. Also sweep
`ingested_units WHERE status = 'pending'` on a timer (take the project from the newest `user_imports` row),
which picks up anything a failed request missed.

Extraction is shared, digestion is per project. A unit may arrive already `ready` because someone else
imported the same video: skip extraction and digest it for the project in the request, unless an
artifact for that unit and project already exists.

1. Set the unit to `running`, extract, then `ready` with `transcript` or `raw_artifact_ref`, or
   `failed` with the actual `error`.
2. Write `artifacts` with `source_ids` containing the unit ids and `project_context_id` /
   `project_context_version` from the request (users only see artifacts for their own project),
   or `artifact_exclusions` with a reason.
3. Render, then upload to R2 under:
   - `videos/<artifact_id>/<version>/short.mp4`: H.264 + AAC, 1080×1920, `-movflags +faststart`
   - `captions/<artifact_id>/<version>/short.vtt`: WebVTT (the browser `<track>` only reads VTT)
   - optional `posters/<artifact_id>/<version>/poster.jpg`
4. Write `video_results` with `media_ref = 'r2:videos/…/short.mp4'` and `caption_ref = 'r2:captions/…/short.vtt'`,
   `status = 'ready'` only after the uploaded file is verified playable. Ready artifacts and videos reach the reel automatically.

Refs are resolved at the Worker, so the bucket stays private and no credentials reach the browser.
Anything other than `r2:<allowed key>` or an `https://` URL is treated as unplayable and left out of the feed.

## Storage choice: Cloudflare R2

- Same platform as the page: a Worker binding, no keys in the browser, same-origin URLs.
- No egress fees, which matters for video. Storage is about $0.015/GB-month; a 40 s 1080×1920 short at
  ~4 Mbps is ~20 MB, so 1,000 shorts is ~20 GB, about $0.30 a month.
- S3-compatible, so a Node/Python renderer uploads with any S3 client.
- TigerData keeps only references and metadata (Postgres is the wrong place for video bytes).

Move to Cloudflare Stream only if adaptive bitrate (HLS) becomes necessary. It bills per minute stored
and delivered, and it re-encodes the uploads. 30 to 45 s progressive MP4s don't need it.

## Setup before deploy

Apply `db/migrations/002_accounts.sql` to TigerData (it only adds `users`, `sessions` and `user_imports`).
Existing databases also need `db/migrations/003_ready_feed.sql` to remove approval gates from the shared feed view.
Historical review columns remain for compatibility; they do not gate processing, playback, or skill readiness.

```
cd web
npx wrangler r2 bucket create resurface-media
npx wrangler secret put DATABASE_URL        # TigerData connection string with ?sslmode=require
npx wrangler secret put PROCESSOR_URL       # once the processor exists
npx wrangler secret put PROCESSOR_TOKEN
```

For local dev, put the same keys in `web/.dev.vars` (gitignored). For production, a Hyperdrive config
bound as `HYPERDRIVE` is preferred over `DATABASE_URL` (pooled connections); `src/db.js` uses it when present.

## Local dev with the simulated processor

`web/scripts/dev-processor.mjs` stands in for the processor so the whole journey can be walked locally.
It refuses any database that isn't on this machine, labels every record `[Simulated]`, points every short
at one test clip. It has no manual review step.

```
createdb resurface_dev
psql -d resurface_dev -f db/migrations/001_shared_schema.sql -f db/migrations/002_accounts.sql
# web/.dev.vars (gitignored):
#   DATABASE_URL=postgres://you@127.0.0.1:5432/resurface_dev
#   PROCESSOR_URL=http://127.0.0.1:8799/process
cd web
npx wrangler r2 object put resurface-media/videos/dev/simulation/short.mp4 --file <any 9:16 mp4> --local
npx wrangler r2 object put resurface-media/captions/dev/simulation/short.vtt --file <any .vtt> --local
DATABASE_URL=postgres://you@127.0.0.1:5432/resurface_dev FAIL_IDS=dQw4w9WgXcQ node scripts/dev-processor.mjs
npm run dev     # http://localhost:8787
```

## Known gaps

- No processor exists yet: links queue in TigerData and show `Queued` until one is connected.
- Sign-up reveals whether an email already has an account (`409`), which is normal sign-up UX but lets
  someone test emails; it's rate limited. There's no email verification or password reset yet.
- Bodies are capped at 32 KB and links at 2,048 characters. Consider Turnstile on sign-up before announcing the URL.
- The API never returns `submitted_url`: a reused unit's original link belongs to whoever pasted it first.
- Source links in the reel are only rendered when they're `http(s)`; they come from model output.
- The D1 waitlist binding is kept so existing signups stay reachable; nothing writes to it.
