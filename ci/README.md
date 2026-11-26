# CI operations

Every job runs on the local self-hosted runner `resurface`, selected with
`[self-hosted, Linux, X64, resurface]`, including the no-checkout `CI required`
aggregate. No job uses a GitHub-hosted runner, so the account's Actions minutes
budget never blocks CI. No job uploads artifacts or uses the Actions cache, so the
account's storage quota is never touched; results stay on the runner. No
deployments, paid provider calls, credentials or production databases are used.
Node 22 is installed by `setup-node` and pinned by major version to match the
application. Jobs install locked dependencies with `npm ci`, which reuses the host's
npm cache. `setup-node` remote caching is off. Third-party actions are pinned to
full commit SHAs. `.github/actionlint.yaml` declares the `resurface` label.

## Local runner

The runner lives in `~/actions-runners/resurface` on the CI host and runs as the
user systemd unit `gh-runner-resurface.service` inside `ci-runners.slice`, like the
host's other runners. It is in the repository's `Default` runner group and has the
labels `self-hosted`, `Linux`, `X64` and `resurface`. The unit sets
`PATH=~/.local/share/mise/shims:~/.local/bin:/usr/local/bin:/usr/bin:/bin`, and the
runner's `.path` file holds the same value.

Host prerequisites, checked by the jobs rather than installed with `sudo`:

| Need                | Where it comes from                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Node 22             | `setup-node`, into the runner tool cache                                                                        |
| Playwright Chromium | `npx playwright install chromium` into `$RUNNER_TOOL_CACHE/ms-playwright`, reused across runs                   |
| ffmpeg, ffprobe     | host packages in `/usr/bin` (nightly/manual render step fails if missing)                                       |
| Chromium            | `/usr/bin/chromium` or `/usr/bin/google-chrome-stable` (nightly/manual render step fails if missing)            |
| Render font         | `RENDER_FONT=/usr/share/fonts/liberation/LiberationSans-Bold.ttf` (nightly/manual render step fails if missing) |

Check the runner:

```sh
systemctl --user status gh-runner-resurface.service
gh api repos/AnalystTom/Major-League-Hacking-Hack-/actions/runners --jq '.runners[] | {name, status, labels: [.labels[].name]}'
```

Re-register it if it disappears from the runners API. Never print the token.

```sh
systemctl --user stop gh-runner-resurface.service
cd ~/actions-runners/resurface
./config.sh remove --token "$(gh api -X POST repos/AnalystTom/Major-League-Hacking-Hack-/actions/runners/remove-token --jq .token)"
./config.sh --unattended --url https://github.com/AnalystTom/Major-League-Hacking-Hack- \
  --token "$(gh api -X POST repos/AnalystTom/Major-League-Hacking-Hack-/actions/runners/registration-token --jq .token)" \
  --name resurface --labels resurface --runnergroup Default --work _work
printf '%s' "$HOME/.local/share/mise/shims:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" > .path
systemctl --user start gh-runner-resurface.service
```

If `config.sh remove` fails because GitHub already dropped the runner, delete
`.runner`, `.credentials` and `.credentials_rsaparams` in that directory and
register again. For a fresh host, unpack the official Linux x64 runner archive into
`~/actions-runners/resurface`, register as above, then install the unit from
`~/.config/systemd/user/gh-runner-resurface.service` with a
`gh-runner-resurface.service.d/20-slice.conf` drop-in that sets
`Slice=ci-runners.slice`, and run `systemctl --user enable --now gh-runner-resurface.service`.

## Fork pull requests

The repository is public and the runner is a private machine, so code from a fork
PR must never run on it without a maintainer looking first. Two layers enforce that:

1. The repository setting **Require approval for all external contributors**
   (`approval_policy: all_external_contributors`) holds every fork PR's workflow run
   until a maintainer approves it. This is the security boundary, because a fork PR
   runs the workflow file from the fork. Check it with
   `gh api repos/AnalystTom/Major-League-Hacking-Hack-/actions/permissions/fork-pr-contributor-approval`.
2. `Change scope`, `Fast checks` and `Journey` each carry a same-repository guard
   (`github.event.pull_request.head.repo.full_name == github.repository`) and are
   skipped for fork PRs. `CI required` checks out nothing and fails for a fork PR
   with a message that a maintainer must review the change and re-run CI from a
   same-repo branch, so it never passes silently.

Do not approve a fork PR's run before reading its diff, including any change under
`.github/`. The workflow uses no `pull_request_target` trigger and no secrets.

## Check contract

| Job / step                 | Protects                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Change scope               | Docs-only changes avoid installs and suites; unknown paths run checks; schedules/manual dispatch always validate                                                                                                                                             |
| Fast checks / format       | Prettier checks CI tooling, workflow and root package metadata; legacy product formatting is not retrofitted                                                                                                                                                 |
| Fast checks / lint         | JavaScript parsing and correctness rules across web source, browser modules, tests, processor and CI tooling; server TypeScript uses its strict compiler                                                                                                     |
| Fast checks / typecheck    | Strict server TypeScript contracts                                                                                                                                                                                                                           |
| Fast checks / tests        | Server unit tests (four render integration files in the heavy job), full web and processor suites, including actual Worker asset routing through the login gate                                                                                              |
| Fast checks / server build | Emitted server build, independently of no-emit typechecking                                                                                                                                                                                                  |
| CI required                | Always reports success/failure, including docs-only skips; fails if scope or fast validation fails or is cancelled                                                                                                                                           |
| Journey and worker builds  | Nightly/manual check for host ffmpeg, ffprobe, Chromium and render font, then full server suite including ffmpeg renders; server build and web/processor Wrangler dry-run bundles, then isolated headless browser journey; serialized across repository runs |

The browser journey uses the existing explicitly synthetic X provider and processor
in `web/test/fixtures/x`. It checks new-user X consent/PKCE wiring, moving scan,
the "Writing your skill" stage (never "Rendering the short" without a video request),
two ready skills, deselection, persistence after reload, default videos off,
explicit video request and no private skills in the public feed. The real-route
unit/API tests in `web/test/x-oauth.test.js` separately protect the 50-bookmark
initial cap, budget reservations and bounded refresh, reconnect and rate limits.
`d1.test.js` protects persisted skill choices and video opt-in.
`site-gate.test.js` protects gate on/off and half-set/blank 503 behavior;
`site-gate-worker.test.js` protects real Wrangler static-asset routing.
`unit-scan.test.js` checks moving/settled stage mappings. No retries, skips or
quarantines are added. The heavy job fails early if ffmpeg, ffprobe or system
Chromium is absent, preventing the existing conditional render tests from silently
skipping. The four integration files (`render`, `motion-skill`,
`end-card-grounding`, `run`) execute in full there; all other server test files
automatically enter the required fast suite. No real X account, AI generation or rendered-video quality
is claimed by synthetic fixtures.

The journey/build job runs on relevant PRs, main pushes, manual dispatch and at
03:25 UTC daily. Full ffmpeg/Chromium server render integration runs only in the
nightly/manual step, avoiding repeated video renders on every PR. Only `CI required` should be required by branch protection; the
heavy job remains visible but does not delay that aggregate. A per-PR/ref
concurrency group cancels obsolete runs, and `resurface-heavy` allows one expensive
job at a time in this repository. GitHub concurrency retains at most one pending
job per group; nightly/manual dispatch is available when a newer pending run
supersedes an older one. Timeouts bound every job. Browser workers are limited to
one and every run uses a fresh context and temporary local D1 state. Existing
fixture ports 28757/28759 must be free; an existing listener is never reused.

## UI evidence review

The journey writes labelled synthetic-fixture screenshots of the scan, skill
picker, kept source-linked skill and video request to `CI_EVIDENCE_DIR`; failures
also retain a screenshot, trace and video. On the runner that directory is
`~/actions-runners/resurface/_work/Major-League-Hacking-Hack-/evidence/journey-<run id>-<attempt>`,
and the job summary prints the exact path and file list. Directories older than
seven days are removed at the start of the next journey. Nothing is uploaded to
GitHub. For a UI change, open every screenshot on the runner host, check desktop/mobile and
keyboard behavior appropriate to the change, and add `## UI quality check` to the
PR description with findings and evidence links. Screenshots are a human review
aid, not a pixel-diff pass. This CI-only change does not alter product UI.

## e2e recorded journeys

`e2e/*.e2e.ts` holds two agentic journeys beside the Playwright ones, driven by
[e2e](https://github.com/e2e-inc/e2e): sign-up with the synthetic X fixture to two
ready skills, and keeping a skill to see its SKILL.md with the source link. They
use the same `node ci/fixture-server.js` launcher on the same ports and never touch
the live site. `e2e.config.ts` fixes the 1440x1000 viewport and `retries: 0`.

CI only replays. The `journey` job runs `CI=1 npm run test:e2e` after
`test:journey`. That script is the single definition of the replay (`e2e run
--strict-cache` with telemetry off), so CI and local runs share it.

The guard is in `e2e.config.ts`. When `CI` is set, the default agent uses a
`noModelCalls` executor instead of `claudeCode`, so no Claude adapter is loaded and
no model is called, even on a runner whose host has a Claude login. A step with no
matching recording then fails with `MODEL_UNAVAILABLE`. A recording that exists but
no longer matches the page fails with `REPLAY_STALE`. Recordings live in
`.e2e/cache/` and are committed. `@e2e-dev/web` brings its own Playwright (1.65.1),
so the job also runs `npx e2e-web install chromium` into the same job-local browser
cache.

Record or repair locally with Claude Code, never in CI:

```sh
npm run record:e2e
npm run test:e2e
```

`record:e2e` runs the steps through `@e2e-dev/acp` on your own Claude Code login and
writes `.e2e/cache/`. Commit the changed entries. Renaming a test or rewording an
`agent.act` instruction is a cache miss. End every test with a locator assertion so
a recording is written, and do not use `agent.assert`, `agent.waitFor` or
`agent.extract` in these tests: they call the model on every run.

## Branch protection

`main` requires the **CI required** check and requires branches to be up to date before merging. `enforce_admins` is off, so repository admins can still bypass it. It was applied on 2026-11-22 with this command:

```sh
gh-axi api PUT repos/AnalystTom/Major-League-Hacking-Hack-/branches/main/protection --input - <<< '{"required_status_checks":{"strict":true,"contexts":["CI required"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}'
```

Read the current settings with `gh api repos/AnalystTom/Major-League-Hacking-Hack-/branches/main/protection`.

## Local reproduction

```sh
npm ci
npm ci --prefix server
npm ci --prefix web
npm ci --prefix deploy/processor
npm run format
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:journey
```

Evidence can be kept outside the checkout with `CI_EVIDENCE_DIR=/absolute/path`.
Playwright shuts down the fixture launcher after success, failure or interruption;
the launcher removes only its own temporary D1 state.
