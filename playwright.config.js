import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./ci",
  testMatch: "journey.js",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  outputDir: process.env.CI_EVIDENCE_DIR || "test-results",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:28757",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node ci/fixture-server.js",
    url: "http://127.0.0.1:28757/start",
    timeout: 120_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
