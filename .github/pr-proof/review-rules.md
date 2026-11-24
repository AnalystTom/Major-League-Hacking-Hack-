# Review rules

Flag any change that breaks a rule below. Cite the rule number in the finding.

## 1. No `useEffect`

- Do not write `useEffect` (or `useLayoutEffect`) in product code.
- Derive values during render, handle changes in event handlers, and use the framework's data, subscription and lifecycle primitives instead.
- `useEffect` is allowed only inside the framework or library layer that wraps it for everyone else.
- If a task seems to need an effect, find or build the wrapper API for it. Do not inline an effect.

## 2. No explanatory comments

- Do not write comments that explain what code does, why it was done, or how it works. Make the code explain itself through names, types and structure.
- Never use a comment to justify a hack, a workaround or a shortcut. Fix the root cause or change the design.
- Allowed: license headers, shebangs, and tool directives that change behavior (`eslint-disable`, `@ts-expect-error`, `# noqa`, `//go:build` and similar).
- When you touch a file, delete the explanatory comments you find in it. Comments go stale, cannot be enforced, and the next agent copies them as examples.
- If you want to leave a comment, the code is wrong. Rename, extract, or add a lint rule or type that makes the constraint explicit.
- This is enforced, not advisory. A Claude Code hook (`pr-proof hook-comments`) rejects any edit that adds a comment, and `pr-proof check` fails a PR that adds one.
- In repos that use ESLint, enable the shared rule: import `/home/russki/.agents/lint/no-comments.mjs` as a plugin and set `"agent/no-comments": "error"`. In other repos, run `pr-proof lint-comments --staged` in the pre-commit hook or CI.

## 3. Build APIs that hide complexity from agents

- Wrap every non-obvious operation (timing, lifecycle, retries, caching, concurrency, auth, cleanup) in one narrow API, so callers never make nuanced choices.
- Make the correct path the default and the shortest path. If the wrong path is available, remove it or make a lint rule or type reject it.
- Keep one paved road per pattern. Do not offer two ways to do the same thing.
- Callers should need no knowledge of internals. If using an API needs a paragraph of explanation, redesign the API.
- When you correct a mistake, move the fix to the strongest layer that can hold it: codebase design first, then types and lint, then tests, and only then written rules.
- Delete outdated patterns and workarounds. Agents copy whatever they find.

## 6. Test priority: e2e and integration first

- Prefer end-to-end journeys and integration tests that run real code paths: a real browser, a real server, a real database or local service.
- Write a unit test only for pure logic with many edge cases, such as parsers, calculators and formatters.
- Do not mock your own modules. Mock only what you cannot run: paid or third-party services.
- Every change to user-visible behavior needs an e2e journey that fails without the change. If the repo has none for that flow, add one.
- Do not add a unit test to cover behavior that a journey or integration test already exercises.
- `pr-proof check` fails a PR that changes behavior code with no e2e or integration test in the diff. A PR that truly needs none adds a `## Test exemption` section with the reason.

## 7. Where fixes go

- When a human corrects you, move the fix to the strongest layer that can hold it, in this order: codebase and API design, then types, lint and compilers, then tests and runtime checks, then verification skills, and only last a written rule.
- When you find a recurring problem, stop the bleeding first with a lint rule or check so it cannot grow, then clean up the existing cases.
- Delete tech debt, deprecated patterns and workarounds you find in the code you touch. Agents copy what they see.
- Add automation (scheduled agents, bots, auto-merge) only after the check-and-verify loop above is reliable. Automating an unreliable loop produces more bad PRs.

## PR description

Every PR description follows the pr-proof format: Before and after, Outcome, What changes for you, What changed, Live results, Not covered, Cost surface, Tests. Flag a description that claims a result without a command, a number or a screenshot behind it.
