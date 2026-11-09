import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

// The full suite, including ffmpeg render integration, runs in the heavy job.
const integration = new Set([
  "outputs/render.test.ts",
  "outputs/motion-skill.test.ts",
  "outputs/end-card-grounding.test.ts",
  "outputs/run.test.ts",
]);
const files = readdirSync("test", { recursive: true })
  .filter((file) => file.endsWith(".test.ts") && !integration.has(file))
  .sort()
  .map((file) => `test/${file}`);
if (!files.length) throw new Error("No server unit tests found");
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "--test-concurrency=1", ...files],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
