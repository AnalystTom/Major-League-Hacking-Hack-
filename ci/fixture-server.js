import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = await mkdtemp(join(tmpdir(), "resurface-ci-"));
const wrangler = "web/node_modules/wrangler/bin/wrangler.js";
const app = "web/test/fixtures/x/wrangler-app.jsonc";
const provider = "web/test/fixtures/x/wrangler-provider.jsonc";
let worker;
let closing = false;
async function close(code) {
  if (closing) return;
  closing = true;
  if (worker && worker.exitCode === null) {
    const exited = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill("SIGTERM");
    const force = setTimeout(() => worker.kill("SIGKILL"), 8000);
    await exited;
    clearTimeout(force);
  }
  await rm(state, { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGTERM", () => close(0));
process.on("SIGINT", () => close(0));
worker = spawn(
  process.execPath,
  [
    wrangler,
    "d1",
    "migrations",
    "apply",
    "resurface-x-fixture",
    "--local",
    "--config",
    app,
    "--persist-to",
    state,
  ],
  { stdio: "inherit" },
);
const code = await new Promise((resolve) => worker.once("exit", resolve));
if (code !== 0) await close(1);
worker = spawn(
  process.execPath,
  [
    wrangler,
    "dev",
    "--config",
    app,
    "--config",
    provider,
    "--persist-to",
    state,
    "--ip",
    "127.0.0.1",
  ],
  { stdio: "inherit" },
);
worker.once("exit", (code) => close(code ?? 1));
