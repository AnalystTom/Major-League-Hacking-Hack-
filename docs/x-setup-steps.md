# One-time Resurface X setup — captain-operated

Prepared 2026-11-08. This is a runbook, not a record of a live setup. No app, purchase, production secret change, production migration, deployment or real X read was performed. The feature branch is not live. X remains optional alongside pasted X/YouTube/Substack links and the existing email sign-in. This branch does not add YouTube OAuth/watch-later import.

## 1. Sign in and create the app

1. On big-machine-1, use a deliberately created isolated operator browser session. The captain signs in to https://console.x.com/ himself, completing account verification and the developer agreement if prompted. Do not use/copy any existing owner profile. Do not expose this authenticated session through public forwarding.
2. Choose **New App**, name it **Resurface**, and describe the real use: users consent to importing private bookmarks into their Resurface account to generate source-linked coding skills. Read access only; no posting, following or bookmark modification. Portal labels can change; the signed-in console is authoritative.
3. In the app authentication settings, enable **OAuth 2.0 user authentication**. Choose a **Web App / confidential client** (server-side client secret), not a native/public client. Enable read permissions. Supply the real website `https://resurface.thomasmann2001.workers.dev/` and truthful privacy/terms/contact information if required. Do not invent legal-document URLs; missing required policies block enabling the app.
4. Register these exact callback values for the corresponding environment:
   - Live Worker: `https://resurface.thomasmann2001.workers.dev/api/auth/x/callback`
   - Optional isolated local real-provider test: `http://127.0.0.1:28757/api/auth/x/callback`
   - Optional localhost test: `http://localhost:28757/api/auth/x/callback` only if that exact host is actually used. Do not interchange localhost/127.0.0.1 or ports. Use a separate test app if the console disallows loopback alongside production.
5. Configure/allow the requested scopes: `tweet.read users.read bookmark.read offline.access`. The authorization request supplies them. `offline.access` enables server-side refresh tokens; no write scope is requested. OAuth 2.0 **Client ID / Client Secret** are the confidential credentials needed; legacy API keys, bearer tokens and manually generated user access tokens are not substitutes.

## 2. Captain purchases the approved credits

1. Open **Billing / Credits** in the signed-in console. Confirm current per-resource rates and the account/app that will be billed. The captain buys **20 USD in pay-per-use credits himself**, once. Do not subscribe to a paid tier or enable automatic top-ups.
2. Leave **auto-recharge off**. If the account exposes a spending-limit control, set its effective limit to **20 USD** for this authorization. The public docs advertise spending limits but do not establish the exact current UI or whether a $20 value is supported; check the signed-in screen. If a setting cannot enforce $20, do not call it a hard account spend cap: the purchased amount, no further funding, disabled auto-recharge and app request budgets are the safeguards. Do not opt into recharge incentives to obtain bonus credits.
3. Check balance and usage before enabling traffic. Existing funds, promotional credits or other apps sharing the balance mean that the visible balance might exceed $20. The code constant `X_PREPAID_CREDIT_CAP_USD = 20` records the authorization; it cannot restrict X billing or detect those extra credits. Do not authorize consuming balances beyond this approval. Turn the read switch off when the approved allocation is exhausted or uncertain; reconcile the console usage. No exact USD metering ledger is implemented in the Worker.
4. Public-user bookmark Post reads currently list at $0.005/resource; a 50-Post first import is about $0.25 plus the identity lookup. Developer-owner Owned Reads may be cheaper but that rate must not be assumed for public users. Refresh uses one-Post pages and stops at the first known ID. **X has no bookmark since_id filter: a boundary Post can be re-billed, about $0.005 per refresh**; each new Post before the boundary also incurs a read. Same-day provider deduplication does not remove later-day charges. Prices may change; confirm them in the console.

## 3. Login-based credential transfer: proposed, not executed

There is no documented OAuth bootstrap that lets Resurface obtain its own confidential app credentials merely by an ordinary user's consent. App creation and credential issuance remain an operator step. A fully unattended login-only setup is **not currently implemented or verified**.

The closest no-paste path is the captain signing in once to the X portal on big-machine-1 and allowing a narrowly scoped agent operation at app-creation time:

1. The captain creates/reveals the confidential OAuth credentials in that isolated session. A one-time secret may only be shown on creation. Do not capture screenshots, accessibility snapshots, terminal output, recordings or traces of that screen.
2. After a separately authorized production configuration window, an agent uses a small local process attached only to that session's browser debugging connection. It reads the specific credential DOM values directly into process memory and supplies them as **stdin** to Wrangler subprocesses. It returns only success/failure, never credential values. No clipboard, arguments, environment variables, files, logs or chat output carry those values. Never use a generic browser eval whose returned values would be printed into a tool transcript. This transfer helper still needs to be built and checked in that authorized setup window; this runbook does not assert it exists.
3. The captain signs in to Cloudflare through Wrangler OAuth (`wrangler login`) in the authorized remote session; no Cloudflare API key is requested. Stage `X_CLIENT_ID` and `X_CLIENT_SECRET` with `wrangler versions secret put <NAME> --config web/wrangler.jsonc` via the in-memory stdin bridge. Record only opaque version IDs. Staging/updating configuration and promoting a version are production operations and require the release authority; this task authorizes none of them. Do not run ordinary `wrangler secret put` casually: it can deploy a new Worker version.
4. If X hides the secret, access is blocked, or secure in-memory transfer cannot be arranged, stop setup and say the login-only credential transfer is unavailable. Do not ask the captain to paste credentials. Regeneration invalidates the old app secret and requires approval; it also requires existing Resurface X connections to reconnect.
5. Close that isolated operator session after transfer, verify its processes exit, and retain no browser profile containing the signed-in portal. Preserve all unrelated owner sessions.

## 4. Bindings and release order

Set the following on the correct Worker environment (production name `resurface`) through the approved signed-in configuration operation:

| Name | Type | Value / purpose |
| --- | --- | --- |
| `X_CLIENT_ID` | Worker secret | Confidential OAuth 2.0 client ID from this app |
| `X_CLIENT_SECRET` | Worker secret | Confidential OAuth 2.0 client secret from this app; used also to encrypt tokens |
| `X_CALLBACK_URL` | Worker variable | Exact environment callback above |
| `X_READS_ENABLED` | Worker variable | Leave absent/`false` initially; only literal `true` enables the integration |
| `X_DAILY_READ_REQUEST_LIMIT` | Worker variable | Default `60` requests/day across the app; choose a lower valid integer to constrain launch usage |
| `X_USER_DAILY_READ_REQUEST_LIMIT` | Worker variable | Default `55` bookmark requests/day per Resurface account; persists across reconnects/sessions |
| `DB` | Existing D1 binding | Existing application database; apply migrations 0005 and 0006 through the authorized release process |
| `AUTH_LIMITER`, `IMPORT_LIMITER` | Existing rate-limit bindings | Existing sign-in/import short-window limits; daily D1 budget is additional |
| `PROCESSOR` / existing processor config | Existing service binding | Existing skill processing path; keep `SHORTS=off` |

There must be **no** `X_PROVIDER` or `X_TEST_AUTHORIZE_URL` test override in production. Local test configuration lives only in `web/test/fixtures/x/`; it uses synthetic credentials and no paid traffic.

Apply migrations and release the reviewed code/configuration only under the separate release authorization. Confirm email/paste fallback first with reads disabled. Then enable explicitly, run one captain-consented live X sign-in/import within the purchased budget, inspect actual console usage, verify 50 cap/refresh behavior and disconnect, and only then describe X import as live. Daily budgets reserve before reads, count errors too, reset at UTC midnight, and are not a USD ledger. Invalid or zero budget values refuse reads. Reconnects preserve the seen-ID set, last-seen boundary and completed first import. Ordinary reload/retry never starts a new completed import; only explicit Refresh does.

## Sources checked

- https://docs.x.com/fundamentals/developer-portal — console app creation, credentials and credits.
- https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token — confidential PKCE client and offline scope.
- https://docs.x.com/x-api/users/get-bookmarks — max_results range 1–100, pagination; no since_id filter.
- https://docs.x.com/x-api/getting-started/pricing — current per-resource pricing, prepaid credits and spending controls.
- https://developers.cloudflare.com/workers/configuration/secrets/ — secret storage and deployment implications; stage version secrets separately from deployment.
