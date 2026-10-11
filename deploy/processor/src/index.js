// The processor (server/) runs in a Cloudflare Container. This Worker gives it a stable HTTPS address for
// the web Worker's PROCESSOR_URL, passes it its keys, and wakes it now and then so the sweeps pick up
// anything left pending. The processor checks the bearer token itself (INGEST_TOKEN).

import { Container, getContainer } from "@cloudflare/containers";

// Worker secrets and vars the processor reads from process.env.
const ENV_NAMES = [
  "GEMINI_API_KEY", "OPENAI_API_KEY", "INGEST_TOKEN", "DATABASE_URL",
  "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET",
  "GEMINI_MODEL", "OPENAI_MODEL", "GEMINI_TTS_MODEL", "GEMINI_TTS_VOICE",
  "WINDOW_SECONDS", "DIGESTION_REQUEST", "SWEEP_INTERVAL_MS", "WEB_ORIGINS",
];

export class Processor extends Container {
  defaultPort = 3000;
  // Long enough for an import to be read, digested and rendered after the request that started it.
  sleepAfter = "30m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = Object.fromEntries(ENV_NAMES.filter((name) => env[name]).map((name) => [name, String(env[name])]));
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== "/health" && !pathname.startsWith("/api/ingest/")) return new Response("Not found", { status: 404 });
    return getContainer(env.PROCESSOR).fetch(request);
  },

  // A health check starts the container if it's asleep, so its sweeps retry anything an import left behind.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(getContainer(env.PROCESSOR).fetch(new Request("http://processor/health")));
  },
};
