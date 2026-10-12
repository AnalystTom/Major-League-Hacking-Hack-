# Motion pipeline PR handoff

The motion package turns ready, evidence-backed artifacts into narrated vertical
videos. It preserves stage caches, validates generated plans, renders H.264/AAC,
checks decoded media, verifies uploaded bytes and then marks video results ready.

## Include in the PR

- `packages/motion-shorts/` source, tests, lockfile and documentation (currently untracked).
- `scripts/setup-local.mjs`, `server/src/env.ts`, the env import in `server/src/index.ts`.
- `.gitignore` and the local-testing documentation.
- `web/public/reel.js`, `web/public/styles.css`, `web/src/feed.js` and
  `web/test/proceed.test.js`: full-size responsive media stage, separate details
  and controls, fullscreen, and explicit detection of the motion renderer's
  burned-in captions to avoid duplicate subtitle overlays. Reconcile these
  frontend edits with main's newer reel/skills UI.
- Keep `.env.local`, `.dev.vars`, artifacts, tools and node_modules ignored.

## Verified locally on October 11

- Web: 22 tests pass. Server: 41 pass, two database tests skipped.
- Motion: 42 tests pass; typecheck and lint pass.
- Updated reel verified with persisted source/video data in an isolated test
  account at desktop and mobile sizes. No media/UI overlap or horizontal overflow;
  play/pause, sources and fullscreen passed. Screenshots and measurements are in
  `packages/motion-shorts/artifacts/reel-qa/` (local QA evidence, not committed).
- A sourced 36-second production clip completed and played through local frontend
  media serving at 1080x1920, 30 fps, with AAC narration/music.
- Cloud R2 authentication, temporary write, exact-byte readback and cleanup passed.
  The local app currently uses local R2, not the cloud bucket.
- Creative requests previously failed at the 180-second client timeout. SDK and
  HTTP deadlines now both default to 900 seconds. The failed animation succeeded
  in about 211 seconds without changing the selected model or reasoning effort.

## Integration issue to resolve before running both branches together

Fetched `origin/main` at `a35a76d` includes a separate automatic video producer in
`server/src/outputs/`, migration 005, skills, X imports and deployment changes.
This local branch is based on `dbacf31`. Latest main has not been merged or tested
with this package. Choose ONE active video producer: main's producer and this
package use different job-claim mechanisms while both write `video_results`.
Do not start both against the same artifact queue. Preserve main's skills work
when selecting the video producer. Review migration 005 compatibility as part
of integration. Main's X importer uses `TWITTERAPI_IO_KEY`, which is distinct from
the saved official X app key/secret.

The repository requires `/ponytail-review` before committing/pushing. That command
was not available in this session, so no commit or push was performed. Run the
required review in the environment that provides it before pushing.

## Hackathon demo

Use one completed clip and show the real import/progress/feed flow. Do not wait
for all eight topics from a source to finish before testing or recording.
Additional clips can continue in the background. Current generation time is
several minutes per clip; generated animation quality and narration alignment
still warrant human review before recording.

## Final performance change

The default worker now uses `src/fast-video.ts`: one compact script request,
parallel TTS, large typography in three designed scenes, and FFmpeg instead of
per-frame browser rendering. A fresh run including upload took 25.5 seconds.
`MOTION_GENERATION_MODE=creative` opts into the older slow pipeline. Frontend
recognizes `resurface-fast-v1` as having burned-in captions.

Latest checks: 105 passing tests (42 motion, 22 web, 41 server); two database
tests skipped. Motion typecheck and lint passed.

Latest submitted Muse source also completed with the fast renderer in 24.4 seconds
including verified delivery; database status is ready. Its 28.7-second H.264/AAC
video was played through the frontend in a headless browser. This timing starts
from an existing backend digest and excludes ingestion and queue time.

## Main integration (October 11)

Main is now integrated through b014817, including skills, handoffs, X import and
processing limits. The CSS conflict was resolved preserving the separate video
stage and main's journey/skills/handoff styles. Earlier branch-status notes above
are historical.

The server skips its built-in video producer when VIDEO_PROVIDER=motion, or when
MOTION_MEDIA_STORAGE is configured and VIDEO_PROVIDER is unset. Skills continue
through both immediate processing and the output sweep. Run the standalone
motion worker for videos. Other deployments retain the built-in producer by
default. Never run both producers on the same queue.

Current motion default is resurface-visual-v3, with sourced diagrams and phrase
captions. The Muse run took 35.9 seconds including upload; this excludes ingestion
and queue waiting. Main integration checks: server 104 passed / 10 skipped,
web 42 passed, motion 45 passed; both typechecks and motion lint passed.
Headless isolated-account QA on http://127.0.0.1:8787 passed signup, feed/import
requests and sample media playback without page errors. Evidence is in
packages/motion-shorts/artifacts/frontend-qa. This is not an end-to-end test of
new ingestion, skills, or handoffs; database migration readiness remains separate.

Local changes are uncommitted. The pre-integration stash is retained as a backup.

## Distinct source designs

Current output revision: resurface-distinct-v6. Shorts now show the source title
prominently, use a stable source-derived palette, name specific subjects, and
choose different diagram geometry for flow, loop, comparison and containment.
Reciprocal edges have separate lanes. The Muse and Grill Me examples were
regenerated and visually inspected; Muse frontend playback passed at desktop and
mobile sizes with no page errors or horizontal overflow. Initial uncached v5
runs took 38.6 and 36.6 seconds including upload; final v6 reused those scripts
and speech, so its times are cached rerender measurements.

Validation: 48 motion tests, 42 web tests, motion typecheck and lint passed.
Remaining existing videos are being refreshed; new jobs use v6.

## Connected animation and playback stability

Current output revision is resurface-connected-v7. Runtime prompts request a
continuous explanation with stable actors and an explicit focus node per beat.
The renderer captures deterministic 24 fps animation in parallel browser pages,
then encodes 30 fps MP4: staggered actor entrances, drawn transfer paths, moving
packets, and separate observation edges. Scene cuts no longer fade to black.

The reel now chooses the most visible eligible clip rather than activating a
clip on a downward intersection-threshold crossing. Cancelled playback promises
cannot restart offscreen videos. Mobile feed growth uses normal document flow;
desktop width accounts for the metadata panel.

Isolated account QA: stationary playback advanced for five seconds with no
play/pause/reload events, scrolling left one video playing, scroll shift was zero,
and there were no page errors. Evidence: artifacts/flicker-qa/report.json.
Muse v7 playback passed desktop/mobile QA. Parallel capture produced byte-identical
video to sequential capture. Cached script/voice generation plus rendering and
upload took 48.6 seconds (sequential capture took 75.8); this does not establish
under-one-minute cold generation. 48 motion and 42 web tests pass; typecheck/lint
pass. Older clips were not bulk-regenerated with this revision.

## Tiger preflight before the next editorial iteration (October 11)

The current generator is `resurface-editorial-v10`. The last saved Muse pilot is
`artifacts/regen-1791757260452/film-2e9e6e6a6445b56f127bfad6/video.mp4`.
It is 60.97 seconds long. Its recorded 90.6-second generation reused the direction
and speech cache; it does not establish cold-generation speed or current database readiness.

At this handoff, root `.env.local` has separate `TIGER_DATA_*` service settings but
no `DATABASE_URL`. Both the Tiger service URL and the older frontend connection
were rejected with `28P01`. The live schema and queue remain unverified; no
migrations, queue processing or new billable rendering were performed in this pass.

After saving the replacement database password in ignored `.env.local`, run:

```powershell
npm.cmd run motion --prefix packages/motion-shorts -- database --configure-tiger
npm.cmd run motion --prefix packages/motion-shorts -- doctor
```

The database command checks TLS, application columns, immutable revisions,
output uniqueness and the feed read model required by migrations 001-009. It
updates only the ignored local database connection files, after a successful
check, and prints no credentials. It never applies migrations. Follow with a
single sourced editorial pilot and isolated headless playback verification;
`worker --once` processes a batch, so it is not a single-clip iteration command.

Checks for this pass: 62 motion tests, motion typecheck/lint, 42 web tests,
104 server tests and server typecheck passed. Ten server tests skipped because
test database access and FFmpeg on PATH were unavailable. No commit or push.
