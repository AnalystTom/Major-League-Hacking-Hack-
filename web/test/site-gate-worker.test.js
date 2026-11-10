import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { experimental_readRawConfig, unstable_dev } from "wrangler";

test("Wrangler routes real static assets through the gate", { timeout: 60000 }, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const { rawConfig } = experimental_readRawConfig({ config: join(root, "wrangler.jsonc") });
  const directory = await mkdtemp(join(tmpdir(), "resurface-gate-"));
  const config = join(directory, "wrangler.json");
  // Use production routing, without database, media or processor dependencies.
  await writeFile(config, JSON.stringify({
    name: "resurface-gate-test",
    main: resolve(root, rawConfig.main),
    compatibility_date: rawConfig.compatibility_date,
    compatibility_flags: rawConfig.compatibility_flags,
    assets: { ...rawConfig.assets, directory: resolve(root, rawConfig.assets.directory) },
  }));
  let worker;
  try {
    worker = await unstable_dev(resolve(root, rawConfig.main), {
      config,
      local: true,
      ip: "127.0.0.1",
      port: 0,
      persist: false,
      vars: { SITE_GATE_USER: "fixture-owner", SITE_GATE_PASSWORD: "fixture-password" },
      logLevel: "error",
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
    });
    for (const path of ["/", "/app.js", "/favicon.svg", "/available", "/api/me", "/media/test.mp4"]) {
      assert.equal((await worker.fetch(path)).status, 401, path);
    }
    for (const path of ["/privacy", "/terms"]) {
      const response = await worker.fetch(path);
      assert.equal(response.status, 200, path);
      assert.match(await response.text(), /tom@thomasmannai\.com/, path);
    }
    // The callback is past the gate: without D1 configured it fails 503 rather than 401.
    assert.notEqual((await worker.fetch("/api/auth/x/callback?state=s&code=c")).status, 401);
    const headers = { authorization: `Basic ${btoa("fixture-owner:fixture-password")}` };
    for (const path of ["/", "/app.js", "/favicon.svg", "/available"]) {
      const response = await worker.fetch(path, { headers });
      assert.equal(response.status, 200, path);
      assert.ok((await response.text()).length > 0, path);
    }
  } finally {
    await worker?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
