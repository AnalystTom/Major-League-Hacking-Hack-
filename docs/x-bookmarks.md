# X sign-in and bookmark import

The same launch branch includes the scan animation from https://github.com/AnalystTom/Major-League-Hacking-Hack-/pull/55 and a new journey: **Continue with X → authorize bookmark access → extract bookmarks → scan actual processing stages → open Skills**. Email sign-in and pasted links remain available. The release configuration now enables explicitly requested videos for kept skills (`SHORTS=on`); deployment and real-provider verification remain separate release steps. See [go-live](go-live.md) for limits, gate removal and rollback.

See the detailed [captain-operated setup runbook](x-setup-steps.md), including the unverified no-paste credential-transfer path and prepaid ceiling.

## Operator setup, through sign-in

The owner signs in to the [X Developer Console](https://console.x.com/) to register a confidential Web App with OAuth 2.0. Register the exact callback `https://<your-site>/api/auth/x/callback`. Configure these Worker bindings through the authenticated platform setup; never add credential fields to the product or ask a user to paste secrets:

- `X_CLIENT_ID` and `X_CLIENT_SECRET`: confidential app credentials, stored as Worker secrets.
- `X_CALLBACK_URL`: exact callback registered with X (HTTPS in production).
- `X_READS_ENABLED`: explicit operator cost switch; only the string `true` enables reads. Credentials alone do not enable reads. Keep off until the captain has created the app and funded the approved $20 prepaid ceiling. No credits were purchased or paid requests performed during implementation.
- `X_DAILY_READ_REQUEST_LIMIT` (default 60) and `X_USER_DAILY_READ_REQUEST_LIMIT` (default 55): positive integer daily request budgets, reserved atomically in D1 before a provider read. Zero or invalid settings stop reads. Both reset at midnight UTC; failed reads still consume a reservation. The global limit includes OAuth identity lookups (per-browser attempt before an X identity exists) and bookmark reads; the per-user limit covers bookmark requests across reconnects and sessions. These are request limits, not a dollar ledger. The `X_PREPAID_CREDIT_CAP_USD = 20` constant documents the externally purchased ceiling; disable auto-recharge and purchase no more than $20. Promotional credits/other apps can affect actual balances, so check the console as well.

Apply migrations `web/migrations/0005_x_oauth.sql` and `0006_x_read_budget.sql` with the project's normal migration process before enabling the flow. Missing configuration or a disabled cost switch displays a clear unavailable message and the working email/paste fallback. The default deployment configuration does not enable X traffic.

Current official pricing is pay-per-use rather than a monthly Basic/Pro subscription. Public-user bookmark reads normally use the Post-read rate; the cheaper Owned Read rate is restricted to the developer app's own user. Confirm current [pricing](https://docs.x.com/x-api/getting-started/pricing) in the owner's signed-in console before enabling traffic. The full dated cost note is in the task evidence directory (`data/resurface-launch-kit/x-api-cost.md` under firstmate).

## Private pre-launch site gate

Set both `SITE_GATE_USER` and `SITE_GATE_PASSWORD` as secrets on the web Worker
(`web/wrangler.jsonc`) through authenticated Cloudflare setup to require the
browser's native HTTP Basic login for the entire site. Never commit or log their
values. The gate covers HTML, static assets, `/available`, `/api`, `/media`, and
the X callback; only `/privacy` and `/terms` (required by the X developer
console) are exempt. Authenticate on the site before starting X sign-in; the
browser can reuse that authentication on return, while OAuth nonce/state cookies
and application sessions still work as before. Use HTTPS outside local development.

The gate is off only when both secrets are absent. If exactly one is set, or
either is empty or whitespace, every route except `/privacy` and `/terms` returns 503 (misconfigured gate)
rather than serving the site. Set both secrets before or together with the
deploy. To open the site at
launch, delete **both** `SITE_GATE_USER` and `SITE_GATE_PASSWORD` from the web
Worker through authenticated Cloudflare secret management and publish that
configuration through the normal authorized release process. Application sign-in
and media permissions remain in force. No secret values are stored in Wrangler
configuration, and adding this gate does not set secrets or deploy anything.

## Account and token handling

The flow requests `tweet.read users.read bookmark.read offline.access`, uses S256 PKCE, and binds a single-use 10-minute state to an HttpOnly browser nonce. Linking an existing local account also requires the same authenticated local account on callback. Accounts are never merged by display name, username or email. The X numeric user ID is the identity. OAuth-only accounts use a reserved internal identifier in the legacy email column; the API exposes no invented email address.

Access tokens stay server-side, encrypted with AES-GCM using a key derived from the confidential app secret; no provider token or PKCE verifier is returned to the browser. Rotating the app secret requires users to reconnect. Refresh tokens are encrypted too; expired access is renewed on the server under the import lease. Reauthorization preserves the import cursor and history. Disconnect clears both local tokens and attempts revocation. The identity mapping and previously imported links/skills remain, so reconnecting preserves the account. If X cannot be reached for revocation, users can also revoke the app in their X account's connected-app settings.

Bookmark pages go through the existing pasted-link validator and import deduplication before being handed to the processor. The first import requests at most the newest 50 returned bookmarks in total: each page sets `max_results` to the remaining allowance. Successful completed imports are never automatically read again, including on reconnect. An explicit refresh uses `max_results=1` (the current documented minimum), follows bookmark order, and stops at the first stored bookmark. Numeric Post IDs are never compared: a newly bookmarked Post may have been created years ago. The stored last-seen ID and set of seen IDs survive reconnect/disconnect. A reload/retry resumes the saved cursor rather than starting another refresh. Only newly linked units are processed.

X does not expose a `since_id` bookmark filter. Firstmate approved bounded overlap: the boundary Post can be returned and billed again, about $0.005 per refresh at the public Post-read rate; the app never re-imports or reprocesses it. If no known boundary remains (for example it was unbookmarked), the daily budget still stops reads. A timeout/crash after an upstream response can also require retrying that page. Application dedupe does not guarantee zero repeated provider charges. No claim of zero-cost refresh is made. A per-connection lease prevents overlapping page reads. Empty results and provider errors are explicit; no placeholder bookmarks enter product results.

The scan uses stored backend stages. A current ready skill with no video settles at “Skill ready”, unless a video was explicitly requested (see [go-live](go-live.md)). Generated skills are still reviewed/copied/downloaded through the existing Skills sheet.

## Isolated fixture verification (no paid APIs)

All provider/processor fixtures and local configs live under `web/test/fixtures/x/`, never in the production asset directory. The bookmarks JSON records the official response shape with synthetic IDs/text, not anyone's private data. The local authorization screen explicitly says it is a fixture. The fixture processor writes staged records and test skills into a local D1 database; it does not invoke model providers or video rendering. This proves application wiring, persistence and polling against controlled responses, not live X access or production AI output.

```sh
npm test --prefix web
npm exec --prefix web -- wrangler d1 migrations apply resurface-x-fixture --local --config web/test/fixtures/x/wrangler-app.jsonc --persist-to /tmp/resurface-x-verification
npm exec --prefix web -- wrangler dev -c web/test/fixtures/x/wrangler-app.jsonc -c web/test/fixtures/x/wrangler-provider.jsonc --persist-to /tmp/resurface-x-verification
```

The app runs at `http://127.0.0.1:28757`, the test authorization screen at `http://127.0.0.1:28757/fixture/authorize`. Use one isolated headless browser context on Big-Machine and clean up only that run. The optional `X_PROVIDER` service binding redirects outbound requests to the test provider. The test authorization URL override is honored only for a loopback request and loopback target; public deployments always redirect to X's real authorization URL. Do not copy either test binding or test credentials into production.
