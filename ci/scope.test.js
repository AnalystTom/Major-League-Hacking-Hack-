import test from "node:test";
import assert from "node:assert/strict";
import { needsChecks } from "./scope.js";

test("only known docs-only diffs skip checks", () => {
  assert.equal(
    needsChecks(["README.md", "docs/guide.md", "audit/report.md"]),
    false,
  );
  assert.equal(needsChecks([]), false);
  for (const path of [
    "web/src/index.js",
    "server/src/index.ts",
    "deploy/processor/Dockerfile",
    ".github/workflows/ci.yml",
    "package-lock.json",
    "ci/scope.js",
    ".gitignore",
    "new-runtime/config.json",
    "README.js",
  ]) {
    assert.equal(needsChecks(["docs/guide.md", path]), true, path);
  }
});
