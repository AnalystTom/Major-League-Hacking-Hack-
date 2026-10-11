// The processor (server/) runs in a Cloudflare Container that sleeps when it has nothing to do. This Worker
// gives it a stable HTTPS address for the web Worker's PROCESSOR_URL, passes it its keys, and wakes it once
// a day so its sweeps retry anything an import left behind. The processor checks the bearer token itself.

import { Container, getContainer } from "@cloudflare/containers";

// Worker secrets and vars the processor reads from process.env.
const ENV_NAMES = [
  "GEMINI_API_KEY", "OPENAI_API_KEY", "INGEST_TOKEN", "DATABASE_URL",
  "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET",
  "GEMINI_MODEL", "OPENAI_MODEL", "GEMINI_TTS_MODEL", "GEMINI_TTS_VOICE",
  "WINDOW_SECONDS", "DIGESTION_REQUEST", "SWEEP_INTERVAL_MS", "WEB_ORIGINS",
];

// However busy it says it is, a container is stopped after this long awake, so a stuck job can't run up
// the bill. Work it was doing is reclaimed and redone on the next wake.
const MAX_AWAKE_MS = 2 * 60 * 60 * 1000;

export class Processor extends Container {
  defaultPort = 3000;
  // Checked this long after the last request; see onActivityExpired.
  sleepAfter = "10m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = Object.fromEntries(ENV_NAMES.filter((name) => env[name]).map((name) => [name, String(env[name])]));
  }

  async onStart() {
    await this.ctx.storage.put("awakeSince", Date.now());
  }

  // Imports run for many minutes without any request reaching the container, so an idle timer alone would
  // stop it mid-job. Ask the processor first, and keep it awake only while it has work in progress.
  async onActivityExpired() {
    const awakeSince = (await this.ctx.storage.get("awakeSince")) ?? Date.now();
    if (Date.now() - awakeSince < MAX_AWAKE_MS && (await this.busy())) return this.renewActivityTimeout();
    await this.stop();
  }

  async busy() {
    try {
      const health = await (await this.containerFetch("http://processor/health")).json();
      return Number(health.busy) > 0;
    } catch {
      return false;
    }
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== "/health" && !pathname.startsWith("/api/ingest/")) return new Response("Not found", { status: 404 });
    return getContainer(env.PROCESSOR).fetch(request);
  },

  // A health check starts the container if it's asleep; it then sleeps again once its sweeps find nothing to do.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(getContainer(env.PROCESSOR).fetch(new Request("http://processor/health")));
  },
};
