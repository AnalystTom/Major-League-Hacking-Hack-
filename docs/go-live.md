# Go live: captain-operated release

This change enables shorts in source configuration, not in production. Do not deploy,
remove the pre-launch gate or pay for a real short as part of this PR. Firstmate deploys
and runs the real-short check after merge. The captain alone authorizes opening the
site. X remains disabled until its separate setup is complete. No credentials belong
in this repository, chat, screenshots or command arguments.

## Shorts and cost controls

`deploy/processor/wrangler.jsonc` sets `SHORTS=on`, `DAILY_VIDEO_LIMIT=20` and
`MONTHLY_VIDEO_LIMIT=400`. The web config carries the same two limits for request
admission. Keep both configs in sync. No other web-side enable flag is needed.

Each account has **one lifetime video slot**, recorded by the primary key on
`user_video_requests.user_id`. Choose **Make my video** on one ready skill; it also
keeps that skill. The server rejects a second selection, even with parallel requests,
a new session or a different artifact version. Duplicate submissions for the same
selection are idempotent. Retries work on that same video; a failure does not create
a fresh account allowance. Historical allocations are backfilled without deleting
existing videos or media. Shared source/approved-video reuse and the public catalogue
remain available.

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
ceiling. One account gets one video, with retries of that same allocation counted
against these global limits. Do not quote USD 9 as a guaranteed per-user bill cap.

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
pause charged starts/video starts. Use `SHORTS=off` to pause new renders while skills
continue; no config change interrupts already running work. Code processing defaults
without release overrides remain 10/40; the web admission defaults are 20/400.

## X developer console: sign-in only

Follow [the captain-operated X setup steps](x-setup-steps.md) as the source of truth:

1. The captain signs in to the X Developer Console in an isolated operator session
   and creates/selects Resurface's confidential Web App. Enable OAuth 2.0 read
   authentication, with `tweet.read users.read bookmark.read offline.access`.
2. Register the exact live callback:
   `https://resurface.thomasmann2001.workers.dev/api/auth/x/callback`. Supply truthful
   website/privacy/terms details; missing required policies block X enablement.
3. Confirm current rates in the signed-in console. Only under the separate funding
   authorization, purchase the approved USD 20 once, leave auto-recharge off, and
   check balance/spending controls as described in that runbook.
4. Sign in to Cloudflare via Wrangler OAuth. Confidential app credentials must reach
   Worker secrets through the separately authorized in-memory transfer described in
   the runbook; never ask the captain to paste a key or secret. That transfer helper
   is not implemented or verified. If it cannot be arranged, leave X disabled and
   use email sign-in/pasted links. Do not claim login-only bootstrap already works.
5. Keep `X_READS_ENABLED` absent/false until callback, secrets, migrations and budget
   checks are complete. Test X only under separate authorization; keep the site gate
   on and authenticate before starting OAuth so the browser can return through it.

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
   choices, processing ledger and X tables are shared by both Workers. Apply `0007_video_limits.sql` before deploying either Worker: it adds the lifetime reservations and video-start ledger. Back up and review historical allocations first. The migration retains existing media and can reduce multiple old request flags to the single preserved allocation.
2. Apply reviewed pending migrations before either code release:
   `npm run db:migrate:remote --prefix web`. Preserve all existing data.
3. Deploy the web Worker, retaining both gate secrets:
   `npm run deploy --prefix web`. Verify unauthenticated `/`, `/available`, `/api/feed`
   and a known media path still challenge with 401; verify half-configured gates
   are not present. Authenticate using the existing operator login, then verify
   email sign-in, paste imports, kept skills and explicit video opt-in.
4. Deploy the processor last: `npm run deploy --prefix deploy/processor`. A local
   image build needs Docker; alternatively use the existing authorized Workers
   Builds path. Do not enable a second deployment mechanism. The processor applies
   changed settings on the next request when idle; busy work finishes first.
   Authenticated `/settings-status` reports matching `sent`, `held` and
   `started_with` hashes once new settings have reached the running container.
5. Firstmate runs one authorized real-short test with a test account behind the
   gate. Confirm source ownership, explicit opt-in, passing judge receipt, playable
   video/captions, usage records and preserved limits. Do not claim ready-to-open
   until that test passes. This PR's synthetic tests cannot establish video quality.

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

- To pause new videos while keeping skills working, change only `SHORTS` back to
  `off` in `deploy/processor/wrangler.jsonc`, review/commit, and redeploy the
  processor. In-flight work may finish; confirm hashes once it becomes idle.
  Preserve both usage limits, existing artifacts and media. A quick version rollback
  to the recorded compatible processor version is another release-operator option:
  `npm exec --prefix deploy/processor -- wrangler rollback <processor-version-id> --config deploy/processor/wrangler.jsonc`.
- For a web regression, restore its recorded compatible version:
  `npm exec --prefix web -- wrangler rollback <web-version-id> --config web/wrangler.jsonc`.
  Inspect gate state immediately after any version rollback: prior versions can
  carry prior secret bindings. Before launch it must still challenge; after launch
  do not accidentally restore the gate unless the captain authorizes re-closing.
- If the captain authorizes re-closing after launch, restore **both** gate secrets
  through signed-in Cloudflare secret management using the approved no-paste path;
  never put values in a file or command argument. Verify a fresh unauthenticated
  request challenges with 401. One secret alone returns 503.
- Do not reverse data migrations or delete media to roll back application code.
  If a previous version is schema-incompatible, pause and prepare a forward fix.
  X reads remain disabled unless separately authorized; disabling X reads is
  independent of pausing videos or controlling the site gate.
