import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_ROOT = dirname(TOOL_DIR);
const LINT_DIR = join(SOURCE_ROOT, "lint");
const GLOBAL_RULES = join(SOURCE_ROOT, "AGENTS.md");
const REVIEW_RULES_FILE = "review-rules.md";
export const VENDOR_DIR = ".github/pr-proof";

const WORKFLOW = `name: PR proof

on:
  pull_request:
    types: [opened, synchronize, reopened, edited, ready_for_review]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: pr-proof-\${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: \${{ fromJSON(vars.CI_RUNNER_LABELS || '["ubuntu-latest"]') }}
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Write the PR description to a file
        env:
          PR_BODY: \${{ github.event.pull_request.body }}
        run: printf '%s' "$PR_BODY" > "$RUNNER_TEMP/pr-body.md"
      - name: Review
        id: review
        env:
          BASE_REF: \${{ github.base_ref }}
          HEAD_SHA: \${{ github.event.pull_request.head.sha }}
          RUN_URL: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}
          COMMIT_URL: \${{ github.server_url }}/\${{ github.repository }}/pull/\${{ github.event.pull_request.number }}/commits/\${{ github.event.pull_request.head.sha }}
        run: |
          set +e
          git checkout --quiet "$HEAD_SHA"
          node ${VENDOR_DIR}/pr-proof/pr-proof.mjs ci-comment --base "origin/$BASE_REF" --body "$RUNNER_TEMP/pr-body.md" --sha "$HEAD_SHA" --run-url "$RUN_URL" --commit-url "$COMMIT_URL" > "$RUNNER_TEMP/comment.md"
          echo "status=$?" >> "$GITHUB_OUTPUT"
      - name: Post or update the review comment
        env:
          GH_TOKEN: \${{ github.token }}
          REPO: \${{ github.repository }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
        run: |
          existing=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate --jq '.[] | select(.body | startswith("<!-- pr-proof-ci-review-bot -->")) | .id' | head -1)
          if [ -n "$existing" ]; then
            gh api -X PATCH "repos/$REPO/issues/comments/$existing" -F body=@"$RUNNER_TEMP/comment.md" > /dev/null
          else
            gh api -X POST "repos/$REPO/issues/$PR_NUMBER/comments" -F body=@"$RUNNER_TEMP/comment.md" > /dev/null
          fi
      - name: Fail when action is required
        if: steps.review.outputs.status != '0'
        run: exit 1
`;

const GREPTILE_SECTIONS = ["1.", "2.", "3.", "6.", "7."];

function reviewerRules() {
  const snapshot = join(SOURCE_ROOT, REVIEW_RULES_FILE);
  if (existsSync(snapshot)) return readFileSync(snapshot, "utf8");
  const text = readFileSync(GLOBAL_RULES, "utf8");
  const sections = text.split(/^## /m).slice(1).filter((section) => GREPTILE_SECTIONS.some((n) => section.startsWith(n)));
  return `# Review rules\n\nFlag any change that breaks a rule below. Cite the rule number in the finding.\n\n${sections.map((s) => `## ${s.trim()}`).join("\n\n")}\n\n## PR description\n\nEvery PR description follows the pr-proof format: Before and after, Outcome, What changes for you, What changed, Live results, Not covered, Cost surface, Tests. Flag a description that claims a result without a command, a number or a screenshot behind it.\n`;
}

const GREPTILE_CONFIG = {
  strictness: 2,
  commentTypes: ["logic", "syntax", "style"],
  triggerOnDrafts: true,
  autoReview: ["open", "push"],
  statusCheck: true,
  fixWithAI: true,
  includeConfidenceScore: true,
  includeIssuesTable: true,
  hideFooter: true,
  ignorePatterns: ".pr-proof/**\nfloorplan/**\n.github/pr-proof/**\n*.png\n*.webm",
  instructions: "Review for correctness first. Then check the repo rules in rules.md. Say what is wrong and what to change in one or two sentences per finding. Do not restate the diff.",
  rules: [
    { id: "no-use-effect", rule: "Do not add useEffect or useLayoutEffect in product code. Derive values in render, handle changes in event handlers, or use the framework primitive.", scope: ["**/*.ts", "**/*.tsx"], severity: "high" },
    { id: "no-explanatory-comments", rule: "Do not add comments that explain what code does or why. Rename, extract or add a type instead. Allowed: license headers, shebangs, and tool directives.", scope: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"], severity: "medium" },
    { id: "e2e-for-behavior", rule: "A change to user-visible behavior needs an end-to-end journey in the same PR that fails without the change. A unit test alone does not count.", scope: ["src/**", "app/**", "tests/**"], severity: "high" },
    { id: "no-mocking-own-modules", rule: "Tests must not mock this repo's own modules. Mock only third-party or paid services.", scope: ["**/*.test.*", "**/*.spec.*"], severity: "medium" },
    { id: "one-paved-road", rule: "Do not add a second way to do something the codebase already does one way. Remove duplicate state and unused layers.", scope: ["**/*.ts", "**/*.tsx"], severity: "medium" }
  ]
};

export function installCi(targetRoot) {
  const vendor = join(targetRoot, VENDOR_DIR);
  const rules = reviewerRules();
  const installingInPlace = existsSync(vendor) && realpathSync(vendor) === realpathSync(SOURCE_ROOT);
  if (!installingInPlace) {
    rmSync(vendor, { recursive: true, force: true });
    mkdirSync(join(vendor, "pr-proof", "lib"), { recursive: true });
    mkdirSync(join(vendor, "lint"), { recursive: true });
    cpSync(join(TOOL_DIR, "pr-proof.mjs"), join(vendor, "pr-proof", "pr-proof.mjs"));
    for (const file of readdirSync(join(TOOL_DIR, "lib"))) {
      cpSync(join(TOOL_DIR, "lib", file), join(vendor, "pr-proof", "lib", file));
    }
    cpSync(join(LINT_DIR, "directives.mjs"), join(vendor, "lint", "directives.mjs"));
    writeFileSync(join(vendor, REVIEW_RULES_FILE), rules);
  }
  mkdirSync(join(targetRoot, ".github", "workflows"), { recursive: true });
  writeFileSync(join(targetRoot, ".github", "workflows", "pr-proof.yml"), WORKFLOW);
  mkdirSync(join(targetRoot, ".greptile"), { recursive: true });
  writeFileSync(join(targetRoot, ".greptile", "config.json"), JSON.stringify(GREPTILE_CONFIG, null, 2) + "\n");
  writeFileSync(join(targetRoot, ".greptile", "rules.md"), rules);
  const files = existsSync(join(targetRoot, "floorplan")) ? { files: [{ path: "floorplan/architecture.json", description: "Machine-readable map of the repo's parts and how they connect" }] } : { files: [] };
  writeFileSync(join(targetRoot, ".greptile", "files.json"), JSON.stringify(files, null, 2) + "\n");
  return [".github/workflows/pr-proof.yml", `${VENDOR_DIR}/ (vendored pr-proof and lint directives)`, ".greptile/config.json", ".greptile/rules.md", ".greptile/files.json"];
}
