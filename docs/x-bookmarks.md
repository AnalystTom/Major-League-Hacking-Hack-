# X sign-in and bookmark import

The same launch branch includes the scan animation from https://github.com/AnalystTom/Major-League-Hacking-Hack-/pull/55 and a new journey: **Continue with X → authorize bookmark access → extract bookmarks → scan actual processing stages → open Skills**. Email sign-in and pasted links remain available. No narrated clips are promised and the processor's `SHORTS=off` setting remains unchanged. This change does not include skill retention/video opt-in from other branches.

## Operator setup, through sign-in

The owner signs in to the [X Developer Console](https://console.x.com/) to register a confidential Web App with OAuth 2.0. Register the exact callback `https://<your-site>/api/auth/x/callback`. Configure these Worker bindings through the authenticated platform setup; never add credential fields to the product or ask a user to paste secrets:

- `X_CLIENT_ID` and `X_CLIENT_SECRET`: confidential app credentials, stored as Worker secrets.
- `X_CALLBACK_URL`: exact callback registered with X (HTTPS in production).
- `X_READS_ENABLED`: explicit operator cost switch. Leave unset/off until paid X traffic is authorized. Credentials alone do not enable reads. No X API credit purchases, plan changes or paid requests were performed for this change.

Apply migration `web/migrations/0005_x_oauth.sql` with the project's normal migration process before enabling the flow. Missing configuration or a disabled cost switch displays a clear unavailable message and the working email/paste fallback. The default deployment configuration does not enable X traffic.

Current official pricing is pay-per-use rather than a monthly Basic/Pro subscription. Public-user bookmark reads normally use the Post-read rate; the cheaper Owned Read rate is restricted to the developer app's own user. Confirm current [pricing](https://docs.x.com/x-api/getting-started/pricing) in the owner's signed-in console before enabling traffic. The full dated cost note is in the task evidence directory (`data/resurface-launch-kit/x-api-cost.md` under firstmate).

## Account and token handling

The flow requests only `tweet.read users.read bookmark.read`, uses S256 PKCE, and binds a single-use 10-minute state to an HttpOnly browser nonce. Linking an existing local account also requires the same authenticated local account on callback. Accounts are never merged by display name, username or email. The X numeric user ID is the identity. OAuth-only accounts use a reserved internal identifier in the legacy email column; the API exposes no invented email address.

Access tokens stay server-side, encrypted with AES-GCM using a key derived from the confidential app secret; no provider token or PKCE verifier is returned to the browser. Rotating the app secret requires users to reconnect. No offline/refresh scope is requested; users reconnect after their access token expires. Disconnect clears the local token and attempts revocation. The identity mapping and previously imported links/skills remain, so reconnecting preserves the account. If X cannot be reached for revocation, users can also revoke the app in their X account's connected-app settings.

Bookmark pages go through the existing pasted-link validator and import deduplication before being handed to the processor. Each connection/import reads at most 100 returned bookmarks, follows `meta.next_token` until done or capped, and displays the real count. Reconnecting starts a new bounded import. A per-connection lease prevents overlapping page reads. Empty results and provider errors are explicit; no placeholder bookmarks enter product results.

The scan uses stored backend stages. A current ready skill with no video settles at “Skill ready”, while video generation remains paused. Generated skills are still reviewed/copied/downloaded through the existing Skills sheet.

## Isolated fixture verification (no paid APIs)

All provider/processor fixtures and local configs live under `web/test/fixtures/x/`, never in the production asset directory. The bookmarks JSON records the official response shape with synthetic IDs/text, not anyone's private data. The local authorization screen explicitly says it is a fixture. The fixture processor writes staged records and test skills into a local D1 database; it does not invoke model providers or video rendering. This proves application wiring, persistence and polling against controlled responses, not live X access or production AI output.

```sh
npm test --prefix web
npm exec --prefix web -- wrangler d1 migrations apply resurface-x-fixture --local --config web/test/fixtures/x/wrangler-app.jsonc --persist-to /tmp/resurface-x-verification
npm exec --prefix web -- wrangler dev -c web/test/fixtures/x/wrangler-app.jsonc -c web/test/fixtures/x/wrangler-provider.jsonc --persist-to /tmp/resurface-x-verification
```

The app runs at `http://127.0.0.1:28757`, the test authorization screen at `http://127.0.0.1:28757/fixture/authorize`. Use one isolated headless browser context on Big-Machine and clean up only that run. The optional `X_PROVIDER` service binding redirects outbound requests to the test provider. The test authorization URL override is honored only for a loopback request and loopback target; public deployments always redirect to X's real authorization URL. Do not copy either test binding or test credentials into production.
