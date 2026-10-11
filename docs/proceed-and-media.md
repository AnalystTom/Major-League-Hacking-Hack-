# Proceed, processing, and where shorts live

Proceed replaces the waitlist. A visitor pastes up to 10 YouTube links, the Worker stores them as
`ingested_units` in TigerData and asks the processor to start, then the page follows each link until
its short is rendered and approved, and plays the approved shorts in a vertical reel.

```
Browser ──POST /api/imports──▶ Worker ──INSERT ingested_units──▶ TigerData
                                  └──POST PROCESSOR_URL {unit_ids}──▶ Processor
Processor: Gemini extraction → Digestion Prompt → artifacts → Opus script → narration/music/render
           ──PUT mp4 + vtt──▶ R2 (resurface-media)   ──UPDATE/INSERT──▶ TigerData
Browser ──GET /api/imports?units=…  (every 4 s until settled)──▶ Worker ──▶ TigerData
        ──GET /api/feed?units=…──▶ Worker ──▶ TigerData (ready + approved only)
        ──GET /media/videos/…mp4 (Range)──▶ Worker ──▶ R2
```

## Endpoints (web Worker, same origin as the page)

| Route | Does |
| --- | --- |
| `POST /api/imports` `{ links }` | Validates and canonicalises links, reuses a non-failed unit for the same video and start time, inserts the rest as `pending`, POSTs the pending ids to the processor. Returns `{ units, processor }` where `processor` is `requested`, `not_configured`, `unavailable` or `not_needed`. |
| `GET /api/imports?units=a,b` | Each unit's stage: `queued`, `fetching`, `digesting`, `rendering`, `in_review`, `ready`, `failed`, `render_failed`, `rejected`, `not_selected`, plus the actual error. |
| `GET /api/feed?units=a,b` | Shorts built from those units whose artifact and video are both `ready` and `approved`. Without `units`, the curated feed, which also needs `feed_order`. |
| `GET /media/<key>` | Streams `videos/`, `captions/` or `posters/` objects from R2 with byte ranges (Safari and seeking need them). |

## What the processor must do

It receives `POST PROCESSOR_URL` with `Authorization: Bearer PROCESSOR_TOKEN` and `{ "unit_ids": [...] }`.
Reply `202` quickly and work asynchronously. The same id can arrive twice, so be idempotent.
Only newly created units are sent; resubmitting a queued link doesn't resend it. So also sweep
`ingested_units WHERE status = 'pending'` on a timer, which picks up anything a failed request missed.

1. Set the unit to `running`, extract, then `ready` with `transcript` or `raw_artifact_ref`, or
   `failed` with the actual `error`.
2. Write `artifacts` (with `source_ids` containing the unit ids) or `artifact_exclusions` with a reason.
3. Render, then upload to R2 under:
   - `videos/<artifact_id>/<version>/short.mp4`: H.264 + AAC, 1080×1920, `-movflags +faststart`
   - `captions/<artifact_id>/<version>/short.vtt`: WebVTT (the browser `<track>` only reads VTT)
   - optional `posters/<artifact_id>/<version>/poster.jpg`
4. Write `video_results` with `media_ref = 'r2:videos/…/short.mp4'` and `caption_ref = 'r2:captions/…/short.vtt'`,
   `status = 'ready'` only after the uploaded file is verified playable, and `review_status = 'pending'`.
5. A teammate sets `review_status = 'approved'` on the artifact and the video. Only then does it reach the reel.

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
at one test clip, and approves clips itself in place of a teammate.

```
createdb resurface_dev && psql -d resurface_dev -f db/migrations/001_shared_schema.sql
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
- `POST /api/imports` is public. It's rate limited to 5 imports per IP per minute (`IMPORT_LIMITER`),
  bodies are capped at 32 KB and links at 2,048 characters. Consider Turnstile too before announcing the URL.
- The API never returns `submitted_url`: a reused unit's original link belongs to whoever pasted it first.
- Source links in the reel are only rendered when they're `http(s)`; they come from model output.
- The D1 waitlist binding is kept so existing signups stay reachable; nothing writes to it.
