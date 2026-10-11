# Resurface project instructions

These instructions apply only to this repository. Verification for this project
does not require big-machine-1 or the Robots/Electron desktop workflow.

- Finish the requested goal and keep responses concise.
- Use real application data in product UI. Show explicit loading, empty, or error
  states when data is unavailable; never fabricate values.
- Run `npm test --prefix web` for web changes and `npm test --prefix server` for
  server changes.
- Verify frontend changes from a new user's perspective with local headless
  Playwright, using an isolated browser context and test account. Return the tested
  URL and evidence. Do not open visible apps or browser windows unless requested.
- Close only browser sessions and test servers created by the verification run;
  preserve existing sessions, profiles, credentials, and unrelated work.
- Run `/ponytail-review` and address its findings before committing or pushing.
  Never bypass or disable the Ponytail pre-commit/push hook.
