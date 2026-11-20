# Go live: captain-operated release

Shorts are enabled in source configuration. Firstmate deploys merged changes and runs
the single authorized real-short check. The captain authorized opening the public
product flow (sign-in, X login, bookmark import, skills) on 2026-11-17; the
[morning checklist](#morning-checklist-captain) lists what only the captain can do.
X stays off until `X_CLIENT_SECRET` is a Worker secret and `X_READS_ENABLED` is
`"true"` in `web/wrangler.jsonc`; see [X go-live session](#x-go-live-session). No
secrets belong in this repository, chat, screenshots or command arguments.

## Shorts and cost controls

`deploy/processor/wrangler.jsonc` sets `SHORTS=on`, `DAILY_VIDEO_LIMIT=20` and
`MONTHLY_VIDEO_LIMIT=400`. `web/wrangler.jsonc` sets `SHORTS=on` and the same two limits
for request admission. The web refuses new video requests while its `SHORTS` is off, and
the processor skips rendering while its own is off. Keep both configs in sync.

Each account has **one lifetime video slot**, recorded by the unique index on
`user_video_requests.user_id`. Since migration `0010` that column is nullable: a deleted
account's row stays with a `NULL` user id, so its spend still counts toward the daily and
monthly ceilings. Choose **Make my video** on one ready skill; it also
keeps that skill. The server rejects a second selection, even with parallel requests,
a new session or a different artifact version. Duplicate submissions for the same
selection are idempotent. Retries work on that same video; a failure does not create
a fresh account allowance. A video the quality judge rejects releases the slot once,
so the account can choose another kept skill; the release is recorded in
`video_rejection_releases` (migration `0009`). Historical allocations are backfilled
without deleting existing videos or media; a failed historical video does not use the
slot. Shared source/approved-video reuse and the public catalogue remain available.

Two atomic database controls bound new work across all accounts:

- The web reserves at most **20 account video requests per UTC day and 400 per UTC
  month**, also refusing admissions when actual video starts have used the budget.
  A full day returns `429` with a `Retry-After` header and a precise UTC retry time;
  a full month gives the next month boundary. No account slot is consumed on refusal.
- The processor records **every video claim** in `video_starts`, including covered
  first attempts, backlog, failed retries, stale takeovers and versioned refreshes.
  The claim and reservation share a serialized D1 transaction, so competing workers
  cannot spend the same last slot. At most **20 render attempts start per UTC day**
  and **400 per UTC month**; retries/refreshes also retain the existing charged-start
  check in `processing_starts`. The tighter limit wins. A running render may finish
  after a boundary; this is a start limit, not a billing-date ledger.

Existing import limits remain: 5 requests per account per minute, up to 20 YouTube,
100 X and 20 Substack links per paste. The original global processing ledger also
uses 20/day and 400/month for extractions/digests/retries; those limits can defer
processing earlier than the video allowance. Missing/failing import limiters refuse
traffic. Optional X retains its separate 60 global/55 account read requests per day,
50-bookmark initial cap and externally controlled USD 20 prepaid authorization.
This PR does not enable X reads or change the quality judge/publication gate.

The Skills sheet reports the real saved state: a full-day message with the UTC retry
time, the already-made message with **Watch your video** linking to approved media,
and a plain generation-failure message. A transient failure says the same video will
retry; a final failure leaves skills usable. Provider internals are not shown in these
messages. The account reservation persists across reloads and retention changes.

### Cost estimate

The last recorded operational unit cost is **about USD 0.45 per rejected short**:
the [7 November configuration note](https://github.com/AnalystTom/Major-League-Hacking-Hack-/blob/d8a27d8/deploy/processor/wrangler.jsonc)
recorded 97 rejected shorts after short 50 at that cost. It is historical evidence,
not a new paid measurement or a guaranteed unit price.

At that observed rate, a fully used allowance of **20 video starts × USD 0.45 is
about USD 9/day globally**; **400 × USD 0.45 is about USD 180/month**. This is the
worst-case allowance calculation **at the observed unit rate**, not a hard dollar
ceiling. One account gets one video at a time, with retries of that same allocation
counted against these global limits; a judge-rejected video releases its slot once.
Do not quote USD 9 as a guaranteed per-user bill cap.

Token/narration length, internal validation calls, two render/judge rounds,
extraction/digestion, hosting/storage and optional X reads can vary or add cost.
Inspect `usage_events` and actual provider billing after firstmate's authorized
real-short check; retain failed-attempt costs. No real generation or deployment was
performed for this change.

The captain can lower both configs together before release (example: 10/day and
40/month). Run from the repository root, review and commit the diff, then follow the
deploy order below:

```sh
python3 -c 'from pathlib import Path; import re; paths=[Path("web/wrangler.jsonc"),Path("deploy/processor/wrangler.jsonc")]; [(p.write_text(re.sub(r"(\"MONTHLY_VIDEO_LIMIT\":\s*\")400(\")",r"\g<1>40\2",re.sub(r"(\"DAILY_VIDEO_LIMIT\":\s*\")20(\")",r"\g<1>10\2",p.read_text())))) for p in paths]'
```

Zero or invalid admission limits refuse new video requests. Zero processing limits
pause charged starts/video starts. Use `SHORTS=off` in both configs to pause new video
requests and renders while skills continue; no config change interrupts already running
work. Code processing defaults without release overrides remain 10/40; the web admission
defaults are 20/400.

## X developer console: sign-in only

Follow [the captain-operated X setup steps](x-setup-steps.md) as the source of truth:

1. The captain signs in to the X Developer Console in an isolated operator session
   and creates/selects Resurface's confidential Web App. Enable OAuth 2.0 read
   authentication, with `tweet.read users.read bookmark.read offline.access`.
2. Register the exact live callback:
   `https://resurface.thomasmann2001.workers.dev/api/auth/x/callback`. Supply the public
   `/privacy` and `/terms` pages (the setup steps give the Website URL); missing
   required policies block X enablement.
3. Confirm current rates in the signed-in console. Only under the separate funding
   authorization, purchase the approved USD 20 once, leave auto-recharge off, and
   check balance/spending controls as described in that runbook.
4. The app exists. Its public OAuth 2.0 client ID and the other X settings are committed in
   the `vars` of `web/wrangler.jsonc`, the single source. The client secret is regenerated
   in the console and typed by the captain only into Wrangler's hidden prompt during the
   [X go-live session](#x-go-live-session).
5. `X_READS_ENABLED` stays `"false"` until the captain confirms the USD 20 is funded
   with auto-recharge off. Turning it on is a one-line change to `web/wrangler.jsonc`,
   merged and deployed as the last part of that session.

## Abuse and spend caps (web Worker vars)

Set in `web/wrangler.jsonc` `vars`; the committed numbers are placeholders for the captain
to set at deploy. A day is a UTC day. An invalid (non-integer) value blocks instead of
allowing. Apply `0008_signup_events.sql` before deploying the web Worker.

| Var | Default | Effect |
|---|---|---|
| `USER_DAILY_IMPORT_LIMIT` | 5 | Links one account may import per day (pasted and X bookmarks), counted from `user_imports.created_at`. Over the cap: 429 with `Retry-After`. |
| `SIGNUP_DAILY_LIMIT` | 200 | New accounts per day across everyone (email and X). Over: 429 "Sign-ups are full for today. Try again tomorrow." |
| `SIGNUP_IP_DAILY_LIMIT` | 5 | New accounts per IP per day. The IP is stored only as a SHA-256 hash in `signup_events`; rows older than two days are deleted. |
| `SIGNUPS` | on | `off` returns 503 "Sign-ups are paused." for email sign-up and for X sign-in that would create an account. Existing accounts still sign in and the site stays public. Change the var and redeploy the web Worker to flip it. |

The processor stays protected by its bearer service tokens (see Processor bridge secrets below), not by the site gate.
Processor caps (`DAILY_VIDEO_LIMIT`, `MONTHLY_VIDEO_LIMIT`) are unchanged.

## Deploy order (after merge, by firstmate)

Commands below run from the repository root, using the approved signed-in Cloudflare
account. Record current web and processor deployment/version IDs before changes:

```sh
npm exec --prefix web -- wrangler deployments list --config web/wrangler.jsonc
npm exec --prefix deploy/processor -- wrangler deployments list --config deploy/processor/wrangler.jsonc
```

1. Confirm clean CI on the merged revision, existing gate secrets on the web Worker,
   and the intended unchanged caps or reviewed lower values. Preserve existing
   secrets, X settings and bindings. Never print secret values. Verify required
   migrations with `npm exec --prefix web -- wrangler d1 migrations list resurface-waitlist --remote --config web/wrangler.jsonc`; review pending migrations before applying them. The account
   choices, processing ledger and X tables are shared by both Workers. Apply `0007_video_limits.sql`, `0008_signup_events.sql` and `0009_video_rejection_releases.sql` before deploying either Worker: they add the lifetime reservations, video-start ledger and per-account rejection releases. Back up and review historical allocations first. The migration retains existing media and can reduce multiple old request flags to the single preserved allocation, and failed videos do not count as an allocation. Then apply `0010_anonymous_spend_ledgers.sql` (after `0009`) before deploying either Worker: it makes `user_id` nullable on the spend ledgers so deleted accounts' spend keeps counting.
2. Apply reviewed pending migrations before either code release:
   `npm run db:migrate:remote --prefix web`. Preserve all existing data.
3. Deploy the web Worker: `npm run deploy --prefix web`. `wrangler deploy` replaces every
   plain-text variable with the `vars` of `web/wrangler.jsonc`, including any set in the
   dashboard; secrets survive. The X settings are committed there, so every deploy keeps them. A name cannot be both a secret and
   a var: the [X go-live session](#x-go-live-session) deletes any of them found in
   `wrangler secret list` before the first deploy. The processor needs no variable: the web
   Worker wakes it through the `PROCESSOR` service binding, and `PROCESSOR_URL` is
   used only by a local web Worker with no binding. Then run `npm run smoke:live` (see
   [Live smoke](#live-smoke)). Before the site is opened, the public-access checks
   fail by design, and the rest of the journey needs `SMOKE_ACCESS_CLIENT_*` or
   `SMOKE_GATE_*`. After it is opened, every check must pass. A half-configured
   in-app gate answers `503`.
4. Deploy the processor last, after its bridge secrets are set ([Processor bridge secrets](#processor-bridge-secrets-required-before-the-processor-deploy)).
   Run `npm run deploy --prefix deploy/processor` on a machine where the deploying user
   can run Docker: `wrangler` builds the container image locally and needs Docker even
   for `--dry-run`. Do not enable a second deployment mechanism. The processor applies
   changed settings on the next request when idle; busy work finishes first.
   Authenticated `/settings-status` reports matching `sent`, `held` and
   `started_with` hashes once new settings have reached the running container.
5. Firstmate runs one authorized real-short test with a test account behind the
   gate. Confirm source ownership, explicit opt-in, passing judge receipt, playable
   video/captions, usage records and preserved limits. Do not claim ready-to-open
   until that test passes. This PR's synthetic tests cannot establish video quality.

## Processor bridge secrets (required before the processor deploy)

The processor Worker gives each caller its own secret: waking the container, the D1 bridge, media uploads
and narration. Each component holds only the secrets it needs:

| Secret (processor Worker) | Opens | Held by |
| --- | --- | --- |
| `INGEST_TOKEN` | `GET /health`, `GET /settings-status`, `POST /api/ingest/process`, `POST /api/ingest/handoff` | web Worker (as its `PROCESSOR_TOKEN`), processor |
| `D1_BRIDGE_TOKEN` | `POST /internal/d1` | processor (passed to the container as `D1_TOKEN`) |
| `MEDIA_UPLOAD_TOKEN` | `PUT` and `DELETE /internal/media` | processor (passed to the container as `MEDIA_TOKEN`) |
| `TTS_BRIDGE_TOKEN` | `POST /internal/tts` | processor (passed to the container as `TTS_TOKEN`) |

The D1 bridge accepts only the statements the container issues (`deploy/processor/src/d1-allowlist.js`)
and refuses anything else with 403; `server/test/db/d1-allowlist.test.ts` fails whenever the stores send a
statement that is not on that list, or the list holds one they no longer send.

Writes that touch a unit check that unit's row before they land. A leaked `D1_BRIDGE_TOKEN` cannot create
units, cannot write over finished units, and cannot write artifacts or exclusions without a live digest
reservation. Usage records and Digestion Prompt revisions are accepted as sent. The limits that remain are
listed under the known limitation below:

- Extraction results only update an existing unit that is `running`, and only to `ready` or `failed`.
- Artifacts, failed-digest records and exclusions are stored only for units that are `ready` and hold a
  digest reservation (`processing_starts`, kind `digest`) under the batch token sent with the write and
  made in the last hour. A reservation is granted only to a unit that still awaits a digest for its
  importers. An artifact needs at least one source. Artifact and failed-digest records take their URL,
  title, content type and retrieval time from the unit rows, so the caller cannot set attribution.
- Skill and brief results are settled only by the matching claim token while the row is `running`.
  Skill and video claims need a `ready` artifact. A video result is settled under the matching claim token
  while it is `running`, or while it is `ready` and marked regenerating. A judge rejection releases an
  account's video request only under the current running claim.

The server ingest CLI, the handoff CLI and the dev ingest API cannot create new units through the D1 bridge.
A new link fails with an explicit error there, because production imports create units in the web app.

`server/test/db/d1-write-integrity.test.ts` runs the container's real write sequence through the bridge and
shows forged writes with caller-chosen IDs, finished units or no reservation are refused.

Known limitation: a holder of the D1 secret can still follow the container's own protocol. It can finish a
running extraction without a claim token, writing its title, transcript, extraction method, extracted_at,
status and error under the unit's ID. It can reserve a unit that awaits a digest and store an artifact with its
own text for it, set the exclusion reason and failed-digest error text for that reserved unit (both shown to
its importer), claim a pending skill, video or brief and settle it with its own content, register a Digestion
Prompt revision, or add usage records. It can also read any unit row by ID, every ready unit with its transcript,
each unit's importer user ID, every ready artifact with its processed text, evidence and sources, and skill
markdown with unit titles and URLs for given skill IDs.
It cannot run arbitrary SQL or read password hashes or X tokens.

Media keys take their content type from the extension (`.mp4`, `.vtt`, `.m4a`). The three new secrets are required before the processor deploy. If
`D1_BRIDGE_TOKEN` is missing, the processor container fails to start as a whole, including
`/api/ingest/process`, not only the bridges. Never print secret values.

Rollout, in this order. Do not skip step 1: deploying the processor without `D1_BRIDGE_TOKEN` stops the
container from starting.

1. Set the three new secrets on the processor Worker with the signed-in account. Generate each value
   in a password manager or with `openssl rand -hex 32`, and enter it only at the `wrangler` prompt:
   `npm exec --prefix deploy/processor -- wrangler secret put D1_BRIDGE_TOKEN --config deploy/processor/wrangler.jsonc`
   and the same for `MEDIA_UPLOAD_TOKEN` and `TTS_BRIDGE_TOKEN`. Confirm the names with `wrangler secret list`.
2. Deploy the processor Worker and its container: `npm run deploy --prefix deploy/processor`.
   Until step 4, the old `INGEST_TOKEN` still wakes the processor and the web Worker still works, but
   it no longer opens the D1, media or narration bridges.
3. Verify: authenticated `/settings-status` shows matching `sent`, `held` and `started_with` hashes,
   and a sweep writes to D1 and R2 through the bridges (watch the processor logs for `D1 batch failed`,
   `R2 put failed`, and `D1 query failed (HTTP 403)` from the container, which means the bridge refused a statement).
   A container that fails to start logs `processor container start failed` from the processor Worker.
4. Retire the old shared token by rotating `INGEST_TOKEN` to a new value. Set the same new value as the
   web Worker's `PROCESSOR_TOKEN` (`wrangler secret put PROCESSOR_TOKEN --config web/wrangler.jsonc`) and
   the processor's `INGEST_TOKEN`, so the old value opens nothing.

Rollback before step 4 is safe: redeploy the previous processor version, which still reads `INGEST_TOKEN`
for the bridges. After step 4, roll back by restoring the previous `INGEST_TOKEN` and `PROCESSOR_TOKEN` values together.

## Remove the gate only when the captain says launch

**Do not run these commands in this PR.** Delete both secrets from the production
web Worker, not the processor, through authenticated Wrangler. Each deletion can
publish a Worker version. Between deletions the deliberately half-set gate returns
503; complete both within the authorized launch window.

```sh
npm exec --prefix web -- wrangler secret delete SITE_GATE_USER --config web/wrangler.jsonc
npm exec --prefix web -- wrangler secret delete SITE_GATE_PASSWORD --config web/wrangler.jsonc
npm exec --prefix web -- wrangler secret list --config web/wrangler.jsonc
curl --fail --silent --show-error --dump-header - --output /dev/null --write-out '%{http_code}\n' https://resurface.thomasmann2001.workers.dev/
curl --fail --silent --show-error --dump-header - --output /dev/null --write-out '%{http_code}\n' https://resurface.thomasmann2001.workers.dev/available
```

Confirm both names are absent and both public pages return 200 without Basic auth
or a `WWW-Authenticate` challenge. In a fresh isolated headless browser context,
verify public assets load, application sign-in works, and private API/media still
require the application session. A private API 401 must be application auth rather
than the site's Basic challenge. Close the verification context afterward.

## Rollback

- To pause new videos while keeping skills working, change `SHORTS` back to `off` in
  both `web/wrangler.jsonc` and `deploy/processor/wrangler.jsonc`, review/commit, and
  redeploy the web and the processor. In-flight work may finish; confirm hashes once it
  becomes idle.
  Preserve both usage limits, existing artifacts and media. A quick version rollback
  to the recorded compatible processor version is another release-operator option:
  `npm exec --prefix deploy/processor -- wrangler rollback <processor-version-id> --config deploy/processor/wrangler.jsonc`.
- For a web regression, restore its recorded compatible version:
  `npm exec --prefix web -- wrangler rollback <web-version-id> --config web/wrangler.jsonc`.
  Inspect gate state immediately after any version rollback: prior versions can
  carry prior secret bindings. Before launch it must still challenge; after launch
  do not accidentally restore the gate unless the captain authorizes re-closing.
- If the captain authorizes re-closing after launch, restore **both** gate secrets
  by running `wrangler secret put` for each gate secret and typing the value at
  Wrangler's hidden prompt; never put values in a file or command argument.
  Verify a fresh unauthenticated request challenges with 401. One secret alone
  returns 503.
- Do not reverse data migrations or delete media to roll back application code.
  If a previous version is schema-incompatible, pause and prepare a forward fix.
  X reads remain disabled unless separately authorized; disabling X reads is
  independent of pausing videos or controlling the site gate.

## Open the public product flow (Cloudflare Access)

As of 2026-11-18 every live path, including `/privacy`, `/terms` and
`/api/auth/x/callback`, answers `302` to the Cloudflare Access login at
`muddy-breeze-11de.cloudflareaccess.com`. The login metadata names the Worker, so this
Access application protects the `resurface` Worker's workers.dev URL. It lives in the
Cloudflare account, not in this repository, and only a signed-in account member can
change it. The in-app gate (`SITE_GATE_USER`/`SITE_GATE_PASSWORD`, `web/src/site-gate.js`)
is a second, independent control. Cloudflare Access is the gate that is currently
enforced. Whether the in-app secrets are also set shows only in
`npm exec --prefix web -- wrangler secret list --config web/wrangler.jsonc`.
Application sessions protect private API and media either way.

**Option A: open the site (the captain's decision C1).**

1. Record what you are about to change, so it can be restored. In
   [Zero Trust](https://one.dash.cloudflare.com/), go to **Access → Applications** and
   open the application whose domain is `resurface.thomasmann2001.workers.dev`. Note its
   name and its policies (action, include rules, allowed emails or groups).
2. In the [Cloudflare dashboard](https://dash.cloudflare.com/), go to **Workers & Pages →
   resurface → Settings → Domains & Routes**. On the `workers.dev` row, turn Cloudflare
   Access off. Leave the `workers.dev` route itself enabled. If that row offers no Access
   control, delete the application from step 1 in **Access → Applications** instead.
3. If the secret list shows `SITE_GATE_USER` or `SITE_GATE_PASSWORD`, run the commands in
   [Remove the gate](#remove-the-gate-only-when-the-captain-says-launch). C1 authorizes it.
4. Run `npm run smoke:live`. All public checks must pass with no operator access.

To revert, turn Cloudflare Access back on for the same `workers.dev` row, or recreate the
application. Then restore the policies recorded in step 1 and confirm that `/` answers
`302` to the Access login again.

**Option B: keep the site private and bypass only what X needs.** In **Access →
Applications**, choose **Add an application → Self-hosted**. Use the hostname
`resurface.thomasmann2001.workers.dev` and add the paths `privacy`, `terms` and
`api/auth/x/callback`. Add one policy with action **Bypass** that includes **Everyone**.
A more specific Access path takes precedence over the hostname-wide application. If the
domain picker does not offer the workers.dev hostname, use Option A. With Option B the
product stays private: every user must still pass Access, and the in-app gate, when set,
still challenges the callback. A browser that has already passed the in-app gate resends
its credentials on X's redirect. To revert, delete the bypass application.

## Live smoke

`npm run smoke:live` runs `ci/live-smoke.js`, the repeatable new-user check, against
`https://resurface.thomasmann2001.workers.dev`. It uses a fresh headless Chromium context
and makes no X request, paid call or email. It needs Playwright's headless Chromium, so
install it once first:

```sh
npx playwright install --only-shell chromium
```

Run the install under Node 22 (what CI uses) or Node 24. Under Node 26, Playwright
1.56.1 finished the download and then stalled with no progress. If your default `node`
is newer, run the same command with a Node 24 binary from your version manager.

It checks:

- `/privacy` and `/terms` are public;
- the X callback reaches the app;
- `/` is public;
- signed-out and private API boundaries hold;
- pages send the security headers (CSP, `x-frame-options`, `nosniff`, referrer policy);
- X sign-in is configured;
- **Continue with X** issues a PKCE S256 authorization to `https://x.com/i/oauth2/authorize`,
  with the live callback and the `tweet.read users.read bookmark.read offline.access` scopes;
- a new user can sign up, sign out and sign back in with email, with no page errors or
  CSP violations.

Each run creates one throwaway account `resurface-smoke+<time>-<random>@example.com`.
`example.com` delivers nowhere. The account counts toward the sign-up caps (200 per day,
5 per IP). The script writes screenshots and `report.json` to `SMOKE_EVIDENCE_DIR`
(default `test-results/live-smoke-<time>`), prints PASS/FAIL for each check and exits
non-zero on any failure.

| Variable | Effect |
|---|---|
| `SMOKE_BASE_URL` | Target origin, for example `http://127.0.0.1:28757` for the local fixture app |
| `SMOKE_GATE_USER`, `SMOKE_GATE_PASSWORD` | In-app gate credentials, sent only to the target origin, so the journey can run while that gate is on |
| `SMOKE_ACCESS_CLIENT_ID`, `SMOKE_ACCESS_CLIENT_SECRET` | Cloudflare Access service token, sent only to the target origin |
| `SMOKE_LOAD_X_CONSENT=1` | Also loads X's authorize page and screenshots it. It reads nothing from X |
| `SMOKE_IMPORT_URL` | **Paid.** Pastes this public link and requires `processor=requested`, then waits for a ready skill (`SMOKE_IMPORT_TIMEOUT_MS`, default 10 minutes). It keeps the skill (`generateVideos: false`) and checks SKILL.md and Download. It never requests a video |

Pass credentials through the environment, never as arguments. The public checks always
run anonymously, so they keep reporting the gate state truthfully. For local proof, run
`node ci/fixture-server.js` and
`SMOKE_BASE_URL=http://127.0.0.1:28757 SMOKE_IMPORT_URL=https://x.com/i/status/1234567890123456789 npm run smoke:live`.
The fixture's X provider and processor are synthetic, so this run costs nothing.

## X go-live session

Run once, in one terminal session on this machine, from the repository root, after the
captain has run `npm exec --prefix web -- wrangler login` (morning checklist step 1).
The X settings are committed in the `vars` of `web/wrangler.jsonc`, the single source;
`X_CLIENT_SECRET` is the only X secret. The processor's
secrets and deploy are separate ([Processor bridge secrets](#processor-bridge-secrets-required-before-the-processor-deploy))
and this session does not change them.

Before step 1, confirm these preconditions. Stop before step 1 if any of the first four is missing:

- [Morning checklist](#morning-checklist-captain) step 1 is done: `wrangler login` succeeded.
- [Morning checklist](#morning-checklist-captain) step 2 is done: the site is opened (Option A), or the Option B bypass covers `api/auth/x/callback`, `privacy` and `terms`. Otherwise the callback answers `302` to the Access login.
- [Morning checklist](#morning-checklist-captain) step 3 is done: the X app exists with the callback registered, and the regenerated client secret is ready for the hidden prompt.
- The local copy is exactly `origin/main` (`git fetch origin`; `git rev-parse HEAD` equals `git rev-parse origin/main`), the tree is clean (`git status --porcelain` prints nothing), and CI on that commit is green (`gh run list --commit <sha>`).
- The captain answers whether the USD 20 is funded with auto-recharge off. This decides whether the session continues past step 6 (see step 7).

1. Confirm the account:

   ```sh
   npm exec --prefix web -- wrangler whoami
   ```

2. List the web Worker's secrets, and record the current version:

   ```sh
   npm exec --prefix web -- wrangler secret list --config web/wrangler.jsonc
   npm exec --prefix web -- wrangler deployments list --config web/wrangler.jsonc
   ```

   If any of `X_CLIENT_ID`, `X_CALLBACK_URL`, `X_READS_ENABLED`, `X_DAILY_READ_REQUEST_LIMIT`
   or `X_USER_DAILY_READ_REQUEST_LIMIT` is listed, delete it, because a name cannot be both a
   secret and a var. Each deletion can publish a Worker version:

   ```sh
   npm exec --prefix web -- wrangler secret delete X_CLIENT_ID --config web/wrangler.jsonc
   npm exec --prefix web -- wrangler secret delete X_CALLBACK_URL --config web/wrangler.jsonc
   npm exec --prefix web -- wrangler secret delete X_READS_ENABLED --config web/wrangler.jsonc
   npm exec --prefix web -- wrangler secret delete X_DAILY_READ_REQUEST_LIMIT --config web/wrangler.jsonc
   npm exec --prefix web -- wrangler secret delete X_USER_DAILY_READ_REQUEST_LIMIT --config web/wrangler.jsonc
   ```

3. The captain types the regenerated client secret at the hidden prompt. It publishes a
   new Worker version:

   ```sh
   npm exec --prefix web -- wrangler secret put X_CLIENT_SECRET --config web/wrangler.jsonc
   ```

4. Back up and review before migrating. Follow [Deploy order](#deploy-order-after-merge-by-firstmate)
   step 1: export the remote D1 database to a file outside the repository, and list the
   pending migrations:

   ```sh
   npm exec --prefix web -- wrangler d1 export resurface-waitlist --remote --config web/wrangler.jsonc --output <backup-file-outside-the-repository>
   npm exec --prefix web -- wrangler d1 migrations list resurface-waitlist --remote --config web/wrangler.jsonc
   ```

   Review the historical allocations as Deploy order step 1 requires. Stop if the backup did
   not complete or the review finds something unexpected. Then apply every pending migration
   in filename order, including `0005` and `0006` if they are pending. Stop only if a pending
   name is not a file in `web/migrations` on the merged revision:

   ```sh
   npm run db:migrate:remote --prefix web
   ```

5. Deploy the web Worker:

   ```sh
   npm run deploy --prefix web
   ```

6. Run the [live smoke](#live-smoke): `npm run smoke:live`. While `X_READS_ENABLED` is
   `"false"`, the check "X sign-in is configured" fails by design, so the run exits `1`. Read the
   PASS/FAIL lines rather than the exit code alone: the only FAIL must be "X sign-in is configured".
   Any other FAIL stops the session before X is enabled.
7. If the USD 20 funding with auto-recharge off was not confirmed at the start, stop here.
   This is the only stopping point. Otherwise continue.
8. Merge the one-line change to `web/wrangler.jsonc` that sets `"X_READS_ENABLED": "true"` through
   the normal path: a firstmate worker opens a PR and merges it once CI is green, under the standing
   Resurface merge authority. Never push directly to `main`. Then fast-forward the local copy to
   `origin/main` (`git pull --ff-only`) and re-check the precondition: HEAD equals `origin/main`,
   the tree is clean, and CI is green on that commit.
9. Redeploy the web Worker from the merged revision with `npm run deploy --prefix web`,
   then rerun `npm run smoke:live`. Every check must pass, including "X sign-in is configured".
10. The captain does their own consent test (morning checklist step 5).

To turn X off again, set `X_READS_ENABLED` back to `"false"`, merge and redeploy the web Worker.

## Morning checklist (captain)

Only the captain can do these steps. Never paste a password, key or secret into chat or
give it to an agent.

1. **Cloudflare sign-in.** On this machine, as user `russki`, run
   `npm exec --prefix web -- wrangler login` from the repository root and approve the
   Resurface Cloudflare account in the browser. Then run
   `npm exec --prefix web -- wrangler whoami`. Firstmate's worker then deploys `main`
   through [Deploy order](#deploy-order-after-merge-by-firstmate) and runs the live smoke.
2. **Open the site.** Do Option A in [Open the public product flow](#open-the-public-product-flow-cloudflare-access).
   The worker can do step 3 of Option A (in-app gate secrets) once Wrangler is signed in.
   Only steps 1–2 need you in the dashboard.
3. **X developer app.** If it is not set up yet, follow [x-setup-steps.md](x-setup-steps.md)
   sections 1–2. Register the callback
   `https://resurface.thomasmann2001.workers.dev/api/auth/x/callback`, use the public
   `/privacy` and `/terms` URLs, request the scopes
   `tweet.read users.read bookmark.read offline.access`, and fund the approved USD 20
   once with auto-recharge off.
4. **X client secret on the Worker.** Regenerate the client secret in the X console and
   type it only into Wrangler's hidden prompt in your own terminal, at step 3 of the
   [X go-live session](#x-go-live-session). The client ID and every other X setting are
   already committed in `web/wrangler.jsonc`. Then, at the start of the session, confirm
   that the USD 20 is funded with auto-recharge off; X turns on only after that (session steps 7–9).
5. **Your own X consent.** Use an ordinary browser window, not an agent's.
   1. Open `https://resurface.thomasmann2001.workers.dev/start` and choose
      **Continue with X**.
   2. On X's screen, confirm that the app is Resurface and that it asks only to read
      posts, profile and bookmarks and to stay connected. Choose **Authorize app**.
   3. You land on `/app?import=x`, and the note reads "Extracting your X bookmarks…".
      Within a few minutes the **Skills** count rises.
   4. Open **Skills**, keep at least one skill with **Keep selected**, then use
      **Copy SKILL.md** or **Download**.
   5. To run the one authorized verification video, choose **Make my video** on one
      skill. It uses this account's single lifetime video and counts against
      20 per day and 400 per month.
6. **Tell firstmate it is done.** The worker reruns `npm run smoke:live` with
   `SMOKE_LOAD_X_CONSENT=1` and checks usage on your account.
