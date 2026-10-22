# Onboarding, processing, and where shorts live

**Status, 11 Oct 2026.** Production serves the waitlist (see the end of this page). Everything else here is
built on `main` plus PRs #3 (processor outputs, Skills and Tasks) and #4 (full-screen reel), and runs in local
dev. The processor's hosting is PR #5. Shorts reach production only when that's deployed and sign-up reopens.

## The journey

1. **Sign up** at `/start`: email and password, nothing else (`users`, `sessions`; `db/migrations/002_accounts.sql`).
   Signing up or in goes straight to `/app`.
2. **Paste links** on `/app`. A new account lands on the reel's 9:16 frame with the paste box in it, focused.
   Up to 20 YouTube videos, 100 X post links (`x.com/<user>/status/<id>`, stored with `content_type = 'x_post'`) and 20 public Substack posts (`<publication>.substack.com/p/<slug>`, stored with `content_type = 'substack_post'`) become `ingested_units`, linked to the user in `user_imports`. Source-reading providers, the optional X key and Article preview limits are documented in the [ingestion README](../server/src/ingest/README.md).
3. **Watch them process.** Until the first short is ready, the frame shows "Making your shorts" with each link's
   real stage; the top-bar status chip stays hidden so the results appear only once and the paste box stays clear.
   Once a short is ready, the chip ("2 ready · 1 couldn't be made") opens the list. Failure reasons follow the
   [unit progress contract](project-actions-spec.md#http-api).
4. **Watch the reel**, full screen at 9:16 below the top bar, edge to edge on phones. **Add videos** opens a sheet
   with the paste box.
5. **Skills** open as a sheet over the reel, from the top-bar button or a short's **View skill** link at its
   skill card. Copy or download a skill for the selected agent; tasks and Send to agent are unavailable.
6. **View available reels & Skills** opens `/available` without requiring sign-in. The landing page links to
   this catalogue instead of displaying sample shorts. Access rules live in the [HTTP contract](project-actions-spec.md#http-api).

There is no project or setup step. Output eligibility follows the [feed contract](project-actions-spec.md#feed-read-contract).
Signed-in visitors see "Open your feed" on the landing page.

## Endpoints (web Worker, same origin as the page)

The [HTTP contract](project-actions-spec.md#http-api) owns routes, response shapes, authentication,
import reuse, progress states, polling, rate limits, and processing spend limits. Local configuration is
listed in [`server/.env.example`](../server/.env.example).

## Who sees what

Units are shared: a video imported by two people is read once. A digest (artifact) can combine several videos,
so **a user sees an artifact, its short and its skill only when they imported every video it was built from**
(`feed.js`, `imports.js`, `skills.js`). That keeps one person's videos out of another's reel. The processor
re-digests a shared video for any importer who can't see a digest of it yet (`server/src/ingest/store.ts`).

This ownership rule applies to personal views. Explicit public designation is separate and follows the
[HTTP contract](project-actions-spec.md#http-api). A single-source digest and a combined digest can both
remain visible; exact deduplication does not collapse overlapping source sets.

## The processor

Node, in `server/src`. `POST /api/ingest/process` takes `{ "unit_ids": [...] }` with
`Authorization: Bearer <INGEST_TOKEN>`, replies `202`, and works in the background. The web Worker calls it with
`PROCESSOR_URL` and `PROCESSOR_TOKEN` (equal to `INGEST_TOKEN`). Timed sweeps pick up anything a request missed.

1. **Extract** (`ingest/`): claim pending units, read each source with its [configured provider](../server/src/ingest/README.md), then `ready` with the
   evidence, or `failed` with the actual error. A unit that's already `ready` isn't read again.
2. **Digest**: the Digestion Prompt (OpenAI) writes `artifacts` (`project_context_id` null) and
   `artifact_exclusions` with reasons. A digest that fails is stored as a failed artifact with its error and is
   retried, up to 3 times per unit.
3. **Skill** (`outputs/skills.ts`): generate the [concise skill contract](project-actions-spec.md#workflow-3-processed-skill-and-codex-use)
   independently of video rendering.
4. **Short** (`outputs/render/`): OpenAI writes the script; Gemini TTS speaks each scene, and measured speech
   determines the timeline and WebVTT cues. The default [motion renderer](../server/assets/motion-graphic-skill/README.md)
   uses headless Chromium; `RENDER_STYLE=basic` selects ffmpeg title cards without music. Both produce
   1080×1920 H.264 + AAC with `+faststart` and burn high-contrast narration captions into the central safe area
   before review. The player fits the whole frame and omits the duplicate WebVTT overlay for burned subtitles.
5. **Checks before upload and `ready`.** The renderer probes dimensions, codecs and duration. An independent
   one-pass model judge checks the artifact, timed narration, a sampled subtitled frame from each scene and
   an additional settled end-card frame. The ready skill's actual name and full description are supplied as
   evidence for the end card only; lesson claims and repository paths still need artifact evidence.
   Grounding, clarity, usefulness, visuals and subtitles must each score at least 4/5 with no recorded defects
   ([judge implementation](../server/src/outputs/render/judge.ts)). A rejection prevents upload and exhausts
   automatic attempts for that generator version; the internal receipt is retained in the stored failure, while progress shows a bounded
   plain-English quality reason. Successful uploads are size-checked; `video_results.review_feedback` retains
   the passing receipt, and `review_status` becomes `approved` before the result is served.

**Legacy outputs.** The sweep considers ready, prompt-backed artifacts with an importer. A ready or failed
video without the current `generator_revision` in its review feedback gets exactly one generation attempt
for the version in [`render/revision.ts`](../server/src/outputs/render/revision.ts). The atomic claim records
that version before rendering, including for a previously exhausted rejection. Approved videos stay ready
with their existing media and passing judge receipt during the attempt. Only a newly approved result swaps
their media references; any failure keeps the prior approved video visible and records the error. Rejected
videos remain hidden unless their replacement passes the unchanged judge. Failed or interrupted refreshes
are not retried for the same generator version. Shorts lacking a passing judge receipt remain withheld.
Ready skills from older prompt revisions are withheld immediately and receive one regeneration
attempt when the processor next handles the eligible artifact. Success records the current prompt revision;
failed or interrupted regeneration keeps the old text unavailable and reports a regeneration state without
an automatic retry. Existing rows, task records and briefs are preserved. Claim and retry rules live in
[`outputs/store.ts`](../server/src/outputs/store.ts), and skill serving policy in
[`web/src/skill-policy.js`](../web/src/skill-policy.js).

R2 keys (resolved by the Worker as `r2:<key>`):
- `videos/<artifact_id>/<version>/<render_id>/short.mp4`
- `captions/<artifact_id>/<version>/<render_id>/short.vtt`
- `audio/<artifact_id>/<version>/<render_id>/narration.m4a`

Each render gets a fresh ID, so partial uploads or a worker that loses its claim cannot overwrite published
bytes. Existing references without a render ID remain valid; stored media is not deleted.

**Claims.** Every job is claimed. A unit's claim, and the claim token on `video_results` or `skill_results`, can be
taken over after 60 minutes (`server/src/claims.ts`), except for the bounded legacy output regeneration above.
A worker whose claim was taken over can't write its result.

**Configuration**: see the [ingestion README](../server/src/ingest/README.md) for provider credentials, models,
output caps and sweep settings, and [`server/.env.example`](../server/.env.example) for local settings.
Media goes to R2 through the processor Worker's `MEDIA` binding, which must point at the same bucket as the
web Worker's `MEDIA` binding. With `D1_URL` and `D1_TOKEN` set, the renderer sends files to
`PUT /internal/media?key=<key>` on the `D1_URL` origin, authenticated with `D1_TOKEN`. The Worker checks the
stored object's size before the renderer saves its `r2:<key>` reference; the web Worker resolves that reference
to `/media/<key>`. No R2 S3 credentials are used.

`MEDIA_LOCAL_WEB_DIR` takes precedence over the bridge and writes to local wrangler dev instead; see
[`server/.env.example`](../server/.env.example) for local storage settings. Without either configuration,
media storage is unavailable. Optional render settings: `GEMINI_TTS_MODEL`,
`GEMINI_TTS_VOICE`, `RENDER_FONT`. Renders need `ffmpeg` and `ffprobe` on the host.

**Hosting** is PR #5: a Cloudflare Container behind a `resurface-processor` Worker that sleeps when idle, to stay
around $5–10 a month. It isn't deployed. It needs Workers Paid and a Workers Builds connection.

## Storage choice: Cloudflare R2

- Same platform as the page: a Worker binding, no keys in the browser, same-origin URLs.
- No egress fees, which matters for video. Storage is about $0.015/GB-month; a 40 s 1080×1920 short at
  ~4 Mbps is ~20 MB, so 1,000 shorts is ~20 GB, about $0.30 a month.
- D1 keeps only references and metadata (D1 is the wrong place for video bytes).

Move to Cloudflare Stream only if adaptive bitrate (HLS) becomes necessary. It bills per minute stored
and delivered, and it re-encodes the uploads. 30 to 45 s progressive MP4s don't need it.

## Setup and local development

Apply `web/migrations/` to the D1 binding with `npm run db:migrate:local --prefix web` or
`npm run db:migrate:remote --prefix web`. The same D1 database holds the waitlist and application records.
See [D1 migration and cutover](applying-migration.md) for preserving existing TigerData records.

The web Worker needs its D1 `DB` binding, R2 `MEDIA` binding, `PROCESSOR_URL` and `PROCESSOR_TOKEN`.
For the processor's D1 connection, see [Processor connection](applying-migration.md#processor-connection).
Its R2 binding and media configuration are described [above](#the-processor).

For local development, run `npm run dev --prefix web` after applying local migrations. A standalone
Node processor uses the same D1 bridge; configure both variables and provider keys in `server/.env`
from `server/.env.example`, and point the web Worker's `PROCESSOR_URL` at its processing route.
Use isolated test databases and accounts. When no processor is configured, imported links remain queued
and the page reports that state; no simulated clips or processing records are created.

## Known gaps

- The proposed Opus-generated animation-code step isn't built; the processor uses the vendored motion template
  described above.
- **Length isn't held to 30–45 s.** See the [timed-script contract's implementation limits](project-actions-spec.md#generation-and-timed-script-contract).
- **Upload checks are size only.** "Playable" is checked on the local file before upload; after upload, only the
  size is compared.
- **Skills only appear once a `skill_results` row exists.** A ready short whose skill was never started shows no
  skill state (the page retries for about 5 minutes).
- Sign-up reveals whether an email already has an account (`409`); it's rate limited. There's no email
  verification or password reset yet. Consider Turnstile on sign-up before reopening it.
- Bodies are capped at 32 KB and links at 2,048 characters. The API never returns `submitted_url`. Reel source
  links render only when they're `http(s)`, since they come from model output.

## Waitlist deployment

The landing page has an email form and **Join the waitlist** links. It shows success only after D1 accepts the signup; duplicate emails stay as one record. Existing waitlist rows are retained.

Deploy with `npm run deploy:waitlist --prefix web`. `web/wrangler.waitlist.jsonc` targets the same `resurface` Worker and `resurface-waitlist` D1 database without requiring the product's D1 or R2 setup. This Worker redirects `/start` and `/app` to the form and does not expose product APIs. The normal `web/wrangler.jsonc` retains the product backend for development and a later launch. Apply `web/migrations/0001_waitlist.sql` only if the table does not exist.
