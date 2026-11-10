# Go live: captain-operated release

This change enables shorts in source configuration, not in production. Do not deploy,
remove the pre-launch gate or pay for a real short as part of this PR. Firstmate deploys
and runs the real-short check after merge. The captain alone authorizes opening the
site. X remains disabled until its separate setup is complete. No credentials belong
in this repository, chat, screenshots or command arguments.

## Shorts and cost controls

`deploy/processor/wrangler.jsonc` sets `SHORTS=on`. The Worker forwards it to the
container; `server/src/index.ts` enables shorts unless it is exactly `off`. There is
no additional web-side enable flag. The existing web `generateVideos` choice remains
opt-in: a video is eligible only for a kept revision requested by an account that
owns all its source imports. Enabling shorts does not bypass the quality judge or
make rejected videos public.

Preserved limits:

- Imports: 5 requests per account per minute (`IMPORT_LIMITER`); absent/failing
  limiter bindings refuse requests. Each paste accepts up to 20 YouTube, 100 X and
  20 Substack links. These are request limits, not daily account spending limits.
- Processor: `DAILY_VIDEO_LIMIT=100` and `MONTHLY_VIDEO_LIMIT=400` charged starts
  across **all accounts**, resetting at UTC day/month boundaries. Code defaults
  without overrides are 10/40. Zero stops charged starts. D1 reserves atomically;
  the tighter ceiling wins and excess work waits until the next allowed boundary.
- Charged starts include extraction, digests not covered by that extraction, and
  output retries (including stale-claim takeovers and versioned refreshes). Retry
  charging is merged in https://github.com/AnalystTom/Major-League-Hacking-Hack-/pull/14.
  A retry with no budget consumes neither a provider call nor another attempt.
  Permanent provider/configuration failures and final quality rejections settle.
- Optional X reads also retain their global 60/day and account 55/day request
  budgets, 50-bookmark first-import cap and the externally controlled $20 prepaid
  authorization; see [X setup](x-setup-steps.md). This PR does not enable X reads.

The last recorded operational unit cost is **about USD 0.45 per rejected short**:
the [processor configuration's 7 November pause note](https://github.com/AnalystTom/Major-League-Hacking-Hack-/blob/d8a27d8/deploy/processor/wrangler.jsonc) recorded 97 rejected shorts
after short 50 at that cost. It is an observed approximate cost, not a new measurement
or provider price guarantee. The older USD 0.12 estimate is obsolete for launch.
At that observed rate, consuming 100/400 charged attempts suggests **about USD 45/day
and USD 180/month globally**. A single account could consume the entire available
global allowance; there is no smaller per-account allocation or dollar cap.

Those dollar figures are **non-guaranteed planning estimates, not worst-case billing
ceilings**. The global ceilings count charged starts, not dollars or every provider
call: first skill/video attempts remain covered by their digest, can fan out into
several artifacts and can run from older backlog on a later day. Internal validation
retries and two render/judge rounds can use several calls per attempt. Token use,
narration, extraction, hosting/storage and optional X reads vary or add cost. Actual
worst-case per-account dollars/day cannot be established from these counters. Check
`usage_events` and provider billing after the authorized real-short test; retain
failed-attempt costs when estimating launch spend.

The captain can lower the two **global charged-start knobs** in the checked-in config
before release (example restores the code defaults; run from the repository root):

```sh
python3 -c 'from pathlib import Path; import re; p=Path("deploy/processor/wrangler.jsonc"); s=p.read_text(); s=re.sub(r"(\"DAILY_VIDEO_LIMIT\":\s*\")100(\")", r"\g<1>10\2", s); s=re.sub(r"(\"MONTHLY_VIDEO_LIMIT\":\s*\")400(\")", r"\g<1>40\2", s); p.write_text(s)'
```

Review and commit the resulting diff, then deploy the processor through the release
process below. This edit is local until deployment. Lowering limits does not stop
already running work or covered first-output attempts; use `SHORTS=off` to pause new
video claims. No new spending subsystem is introduced here.

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
   choices, processing ledger and X tables are shared by both Workers.
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
