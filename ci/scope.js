import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Unknown paths fail open into validation; only known documentation skips work.
export function needsChecks(paths) {
  return paths.some(
    (path) =>
      !/^(?:docs\/|audit\/|(?:README|AGENTS|CLAUDE)(?:\.md)?$|LICENSE(?:\.txt)?$)/.test(
        path,
      ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.BASE;
  const force = ["schedule", "workflow_dispatch"].includes(process.env.EVENT);
  const paths =
    !force && base && !/^0+$/.test(base)
      ? execFileSync("git", ["diff", "--name-only", base, "HEAD"], {
          encoding: "utf8",
        })
          .trim()
          .split("\n")
          .filter(Boolean)
      : null;
  console.log(`code=${paths === null || needsChecks(paths)}`);
}
