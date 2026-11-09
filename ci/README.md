# CI operations

Every job that runs repository code uses `[self-hosted, Linux, X64, big-machine]`, including the no-checkout `CI required` aggregate. No deployments, paid
provider calls, credentials or production databases are used. Node 22 is pinned
by major version to match the application. Jobs install locked dependencies with
`npm ci` and cache the npm download cache rather than mutable `node_modules`.

## Fork pull requests

The repository is public and the runner is a private machine, so fork PRs must never
execute on it. `Change scope`, `Fast checks` and `Journey` each carry a same-repository
guard and are skipped for fork PRs. `CI required` always runs on the runner, checks out
nothing, and fails for a fork PR with a message that a maintainer must review the change
and re-run CI from a same-repo branch, so it never passes silently.

The guards live in the workflow file, which a pull request can edit, so they are not a
security boundary. Before the runner is used, the owner must set Settings → Actions →
General → **Require approval for all outside collaborators** (captain-owned; not changed
here).

## Runner prerequisite

On 9 November 2026, `GET /repos/AnalystTom/Major-League-Hacking-Hack-/actions/runners`
returned zero runners. `GET /repos/AnalystTom/Robots/actions/runners` confirmed an
online Linux x64 runner named `big-machine-robots`, with custom labels
`big-machine` and `robots`. A repository runner registered for Robots cannot
serve this repository.

The owner must sign into GitHub, open this repository's **Settings → Actions →
Runners → New self-hosted runner**, choose Linux x64, and execute GitHub's displayed
download/configuration instructions on Big-Machine in a new dedicated runner
directory. Give it the custom label `big-machine`, retain the default
`self-hosted`, `Linux`, `X64` labels, and install/start its service using the
provided service instructions. Do not reconfigure or stop the existing Robots
runner. Use GitHub's temporary registration instructions directly; do not paste a
registration token into chat. Verify this repository shows the new runner Online
before expecting checks to complete. The host needs ffmpeg, ffprobe, Chromium at /usr/bin/chromium or /usr/bin/google-chrome, Docker and Chromium system libraries;
`npx playwright install chromium` downloads the pinned browser without running
sudo or modifying system packages in CI.

## Check contract

| Job / step                 | Protects                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change scope               | Docs-only changes avoid installs and suites; unknown paths run checks; schedules/manual dispatch always validate                                                                              |
| Fast checks / format       | Prettier checks CI tooling, workflow and root package metadata; legacy product formatting is not retrofitted                                                                                  |
| Fast checks / lint         | JavaScript parsing and correctness rules across web source, browser modules, tests, processor and CI tooling; server TypeScript uses its strict compiler                                      |
| Fast checks / typecheck    | Strict server TypeScript contracts                                                                                                                                                            |
| Fast checks / tests        | Server unit tests (four render integration files in the heavy job), full web and processor suites, including actual Worker asset routing through the login gate                               |
| Fast checks / server build | Emitted server build, independently of no-emit typechecking                                                                                                                                   |
| CI required                | Always reports success/failure, including docs-only skips; fails if scope or fast validation fails or is cancelled                                                                            |
| Journey and worker builds  | Nightly/manual full server suite including ffmpeg renders; server build and web/processor Wrangler dry-run bundles, then isolated headless browser journey; serialized across repository runs |

The browser journey uses the existing explicitly synthetic X provider and processor
in `web/test/fixtures/x`. It checks new-user X consent/PKCE wiring, moving scan,
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

The optional journey/build job runs on relevant PRs, main pushes, manual dispatch and at
03:23 UTC daily. Full ffmpeg/Chromium server render integration runs only in the
nightly/manual step, avoiding repeated video renders on every PR. Only `CI required` should be required by branch protection; the
heavy job remains visible but does not delay that aggregate. A per-PR/ref
concurrency group cancels obsolete runs, and `resurface-heavy` allows one expensive
job at a time in this repository. GitHub concurrency retains at most one pending
job per group; nightly/manual dispatch is available when a newer pending run
supersedes an older one. Timeouts bound every job. Browser workers are limited to
one and every run uses a fresh context and temporary local D1 state. Existing
fixture ports 28757/28759 must be free; an existing listener is never reused.

## UI evidence review

The journey attaches labelled synthetic-fixture screenshots of the scan, skill
picker, kept source-linked skill and video request to `test-results/`; failures
also retain a screenshot, trace and video. The artifact is retained seven days.
For a UI change, download and open every screenshot, check desktop/mobile and
keyboard behavior appropriate to the change, and add `## UI quality check` to the
PR description with findings and evidence links. Screenshots are a human review
aid, not a pixel-diff pass. This CI-only change does not alter product UI.

## Branch protection (owner approval required)

Settings are unchanged. Exact required check context: **CI required**.
After the runner is online and the workflow has reported that context, the owner
can approve this one-line command:

```sh
gh-axi api PUT repos/AnalystTom/Major-League-Hacking-Hack-/branches/main/protection --input - <<< '{"required_status_checks":{"strict":true,"contexts":["CI required"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}'
```

This enables the named check and requires the branch to be up to date. It is a proposal for the currently unprotected main, not a command CI runs.

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
