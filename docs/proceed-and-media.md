# Onboarding, processing, and where shorts live

**Status, 11 Oct 2026.** Production serves the waitlist (see the end of this page). Everything else here is
built on `main` plus PRs #3 (processor outputs, Skills and Tasks) and #4 (full-screen reel), and runs in local
dev. The processor's hosting is PR #5. Shorts reach production only when that's deployed and sign-up reopens.

## The journey

1. **Sign up** at `/start`: email and password, nothing else (`users`, `sessions`; `db/migrations/002_accounts.sql`).
   Signing up or in goes straight to `/app`.
2. **Paste links** on `/app`. A new account lands on the reel's 9:16 frame with the paste box in it, focused.
   Up to 20 YouTube videos, 100 X post links (`x.com/<user>/status/<id>`, stored with `content_type = 'x_post'`) and 20 public Substack posts (`<publication>.substack.com/p/<slug>`, stored with `content_type = 'substack_post'`) become `ingested_units`, linked to the user in `user_imports`. X posts are read as text from twitterapi.io (`TWITTERAPI_IO_KEY` on the processor); no model is involved in reading them. Substack posts are read through Nimble (`NIMBLE_API_KEY` on the processor); paywalled posts fail with that reason.
3. **Watch them process.** Until the first short is ready, the frame shows "Making your shorts" with each link's
   real stage. After that, a top-bar status chip ("2 ready · 1 couldn't be made") opens the same list with the
   actual errors.
4. **Watch the reel**, full screen at 9:16 below the top bar, edge to edge on phones. **Add videos** opens a sheet
   with the paste box.
5. **Skills and Tasks** open as a sheet over the reel, from top-bar buttons with counts or a short's
   **View skill & tasks** link (which opens the sheet at that skill's card). Skills reach an agent by copy or
   download; nothing is delivered directly.

There is no project, setup step, or review gate: whatever the processor marks `ready` is shown. Signed-in
visitors see "Open your feed" on the landing page.

```
Browser ──POST /api/auth/signup──▶ Worker ──INSERT users, sessions──▶ D1   (httpOnly cookie back)
        ──POST /api/imports──▶ Worker ──INSERT ingested_units, user_imports──▶ D1
                                  └──POST PROCESSOR_URL {unit_ids}──▶ Processor (server/src)
Processor: Gemini extraction → Digestion Prompt (OpenAI) → artifacts
           → skill + up to 3 tasks (OpenAI)             ──▶ skill_results, action_items
           → script (OpenAI) → narration (Gemini TTS) → ffmpeg ──PUT mp4, vtt, m4a──▶ R2 ──▶ video_results
Browser ──GET /api/imports, /api/feed?scope=mine, /api/skills (every 4 s while anything moves)──▶ Worker ──▶ D1
        ──POST /api/handoffs {skill_ids}──▶ Worker ──INSERT agent_briefs──▶ D1
                                  └──POST …/api/ingest/handoff {brief_id}──▶ Processor
Processor: merge the picked skills → Handoff refinement (OpenAI) → prompt per agent and mode ──▶ agent_briefs
Browser ──GET /api/handoffs/:id (every 3 s until ready)──▶ Worker   then copy or download the prompt into the agent
        ──GET /media/videos/…mp4 (Range)──▶ Worker ──▶ R2
        ──POST /api/handoffs {skill_ids}──▶ Worker ──INSERT agent_briefs──▶ D1
                                  └──POST …/api/ingest/handoff {brief_id}──▶ Processor
Processor: merge the picked skills → Handoff refinement → prompt per agent and mode ──UPDATE agent_briefs──▶ D1
Browser ──GET /api/handoffs/:id (every 3 s until ready)──▶ Worker   then copy/download the prompt into Codex
```

## Endpoints (web Worker, same origin as the page)

Every mutation must be `application/json`; with the `SameSite=Lax` session cookie that blocks cross-site forms.

| Route | Does |
| --- | --- |
| `POST /api/auth/signup` `{ email, password, name? }` | Creates the account (password ≥ 10 chars, PBKDF2-SHA256, 100k iterations) and signs in. `409` if the email is taken. |
| `POST /api/auth/login` `{ email, password }` | Signs in. Wrong password and unknown email get the same `401`. |
| `POST /api/auth/logout` | Ends the session. |
| `GET /api/me` | `{ user, imports }`; `{ user: null }` when signed out. |
| `POST /api/imports` `{ links }` | Canonicalises links, reuses a non-failed unit for the same video and start time, links each to the user, and sends units new to this user to the processor. Returns `{ units, processor }`. |
| `GET /api/imports` | The user's links with their stage: `queued`, `fetching`, `digesting`, `rendering`, `ready`, `failed`, `render_failed`, `not_selected`, plus the actual error. |
| `GET /api/feed?scope=mine` | The user's shorts: artifacts they can see (below) whose artifact and video are both `ready`. |
| `GET /api/skills` | The newest skill per visible ready artifact: `{ id, status, error, artifact, name, description, markdown, videos, action_items }`. Tasks carry `task`, `prerequisites`, `steps`, `completion_check` and `evidence`. |
| `GET /api/feed` | The public curated feed (needs `feed_order`); no account. |
| `POST /api/handoffs` `{ skill_ids }` | Queues one agent prompt for 1-12 of the user's ready skills (reused for the same skill revisions) and asks the processor to write it. Returns `{ brief, processor }`. |
| `GET /api/handoffs/:id`, `GET /api/handoffs/latest` | The brief: `status`, actual `error`, title, summary, themes, tensions, actions, and `prompts` per agent (`claude`, `codex`, `cursor`, `hermes`) and mode (`review`, `apply`) once ready. |
| `GET /media/<key>` | Streams `videos/`, `captions/` or `posters/` objects from R2 with byte ranges (Safari and seeking need them). Narration under `audio/` is stored but not served. |

The page polls the three read routes every 4 s while a link is moving or a skill is being written. When a short
is ready but its skill hasn't started, it checks every 20 s, at most 15 times. A failing `/api/skills` doesn't stop
links and shorts from updating.

Rate limits: sign-up and sign-in 10 per IP per minute (`AUTH_LIMITER`), imports 5 per account per minute (`IMPORT_LIMITER`).

Processing limits cap provider spend across all users: the processor starts at most `DAILY_VIDEO_LIMIT` new units
per UTC day (default 10) and `MONTHLY_VIDEO_LIMIT` per UTC month (default 40, about $5 at ~$0.12 a short with the
5-minute window). Each paid start is recorded in `processing_starts` (`db/migrations/007_processing_starts.sql`):
every extraction is charged, and so is every digest except the first one after a unit's extraction, so a new video
costs one slot while re-digests of shared videos and retries cost their own. Every source type, sweep and retry
counts; `0` pauses processing. Links over the limit stay saved, show **Limit reached** with when they'll start
(`ingested_units.deferred_until`), and the sweeps start them once there's room. The processor's dev `/imports` route,
which reads links directly, is only mounted with `ENABLE_DEV_IMPORTS=1`.

## Who sees what

Units are shared: a video imported by two people is read once. A digest (artifact) can combine several videos,
so **a user sees an artifact, its short and its skill only when they imported every video it was built from**
(`feed.js`, `imports.js`, `skills.js`). That keeps one person's videos out of another's reel. The processor
re-digests a shared video for any importer who can't see a digest of it yet (`server/src/ingest/store.ts`).

**Open decision.** This replaces the earlier "digested once, shared by everyone" rule, and it can give someone a
second short covering a video that's already in a combined digest. The alternative is fully shared digests, which
means people see others' videos. The user hasn't chosen yet.

## The processor

Node, in `server/src`. `POST /api/ingest/process` takes `{ "unit_ids": [...] }` with
`Authorization: Bearer <INGEST_TOKEN>`, replies `202`, and works in the background. The web Worker calls it with
`PROCESSOR_URL` and `PROCESSOR_TOKEN` (equal to `INGEST_TOKEN`). Timed sweeps pick up anything a request missed.

1. **Extract** (`ingest/`): claim pending units, read each video's window with Gemini, then `ready` with the
   evidence, or `failed` with the actual error. A unit that's already `ready` isn't read again.
2. **Digest**: the Digestion Prompt (OpenAI) writes `artifacts` (`project_context_id` null) and
   `artifact_exclusions` with reasons. A digest that fails is stored as a failed artifact with its error and is
   retried, up to 3 times per unit.
3. **Skill** (`outputs/skills.ts`): one ready artifact becomes a `SKILL.md` (front matter `name` and `description`,
   a review warning, `## Sources`) and up to three tasks, each with steps and a `completion_check`.
4. **Short** (`outputs/render/`): OpenAI writes a 4–6 scene script (about 70–110 words of narration). Gemini TTS
   speaks each scene, and the scene times come from the measured speech. Captions are WebVTT cues spread over
   that speech. ffmpeg composes one title card per scene over the narration, 1080×1920 H.264 + AAC with
   `+faststart`. There's no music in v0.
5. **Checks before `ready`.** The rendered file must probe as 1080×1920 H.264 with an AAC track, and its duration
   must match the timeline within a second. Each upload is read back and its size compared. `video_results` then
   records the script, the models used, `media_ref`, `caption_ref`, `narration_ref` and the measured duration.

R2 keys (resolved by the Worker as `r2:<key>`):
- `videos/<artifact_id>/<version>/short.mp4`
- `captions/<artifact_id>/<version>/short.vtt`
- `audio/<artifact_id>/<version>/narration.m4a`

**Claims.** Every job is claimed. A unit's claim, and the claim token on `video_results` or `skill_results`, can be
taken over after 60 minutes (`server/src/claims.ts`), which is longer than the slowest extraction or render. A
worker whose claim was taken over can't write its result.

**Configuration** (`server/.env.example`): `GEMINI_API_KEY` and `INGEST_TOKEN` mount ingestion. `OPENAI_API_KEY`
enables digests, skills and scripts; without it, units are only extracted. `D1_URL and D1_TOKEN` enables the sweeps.
Media goes to R2 through its S3 API (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`),
or to local wrangler dev with `MEDIA_LOCAL_WEB_DIR`. Optional: `OPENAI_MODEL`, `GEMINI_MODEL`, `GEMINI_TTS_MODEL`,
`GEMINI_TTS_VOICE`, `RENDER_FONT`, `SWEEP_INTERVAL_MS`. Renders need `ffmpeg` and `ffprobe` on the host.

**Hosting** is PR #5: a Cloudflare Container behind a `resurface-processor` Worker that sleeps when idle, to stay
around $5–10 a month. It isn't deployed. It needs Workers Paid and a Workers Builds connection.

## Storage choice: Cloudflare R2

- Same platform as the page: a Worker binding, no keys in the browser, same-origin URLs.
- No egress fees, which matters for video. Storage is about $0.015/GB-month; a 40 s 1080×1920 short at
  ~4 Mbps is ~20 MB, so 1,000 shorts is ~20 GB, about $0.30 a month.
- S3-compatible, so a Node/Python renderer uploads with any S3 client.
- D1 keeps only references and metadata (D1 is the wrong place for video bytes).

Move to Cloudflare Stream only if adaptive bitrate (HLS) becomes necessary. It bills per minute stored
and delivered, and it re-encodes the uploads. 30 to 45 s progressive MP4s don't need it.

## Setup and local development

Apply `web/migrations/` to the D1 binding with `npm run db:migrate:local --prefix web` or
`npm run db:migrate:remote --prefix web`. The same D1 database holds the waitlist and application records.
See [D1 migration and cutover](applying-migration.md) for preserving existing TigerData records.

The web Worker needs its D1 `DB` binding, R2 `MEDIA` binding, `PROCESSOR_URL` and `PROCESSOR_TOKEN`.
The processor Worker holds a binding to the same D1 database and forwards it to the Node container
through its authenticated `/internal/d1` route. The container receives `D1_URL` and `D1_TOKEN` at startup.

For local development, run `npm run dev --prefix web` after applying local migrations. A standalone
Node processor uses the same D1 bridge; configure both variables and provider keys in `server/.env`
from `server/.env.example`, and point the web Worker's `PROCESSOR_URL` at its processing route.
Use isolated test databases and accounts. When no processor is configured, imported links remain queued
and the page reports that state; no simulated clips or processing records are created.

## Known gaps

- **Shorts are basic title cards**: one large text frame per scene over narration, with no motion design and no
  stored animation code. The spec's Opus script and animation-code step isn't built.
- **Length isn't held to 30–45 s.** Only the script's word count (40–160) is checked, so roughly 15–65 s passes.
- **Citations are optional.** Script scenes and tasks may carry no `source_ids` or evidence, though the spec
  requires traceable evidence for factual claims.
- **Upload checks are size only.** "Playable" is checked on the local file before upload; after upload, only the
  size is compared.
- **Skills only appear once a `skill_results` row exists.** A ready short whose skill was never started shows no
  skill state (the page retries for about 5 minutes).
- **The visibility rule is still open** (see Who sees what).
- Sign-up reveals whether an email already has an account (`409`); it's rate limited. There's no email
  verification or password reset yet. Consider Turnstile on sign-up before reopening it.
- Bodies are capped at 32 KB and links at 2,048 characters. The API never returns `submitted_url`. Reel source
  links render only when they're `http(s)`, since they come from model output.

## Waitlist deployment

The landing page has an email form and **Join the waitlist** links. It shows success only after D1 accepts the signup; duplicate emails stay as one record. Existing waitlist rows are retained.

Deploy with `npm run deploy:waitlist --prefix web`. `web/wrangler.waitlist.jsonc` targets the same `resurface` Worker and `resurface-waitlist` D1 database without requiring the product's D1 or R2 setup. This Worker redirects `/start` and `/app` to the form and does not expose product APIs. The normal `web/wrangler.jsonc` retains the product backend for development and a later launch. Apply `web/migrations/0001_waitlist.sql` only if the table does not exist.
