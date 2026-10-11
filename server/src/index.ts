// Node entry point: `npm run dev` locally, or `npm run build && npm start` on any Node host.

import { serve } from "@hono/node-server";
import pg from "pg";
import type { StoredArtifact } from "./ingest/types.js";
import { createApp, parseOrigins } from "./app.js";
import { setUsageSink } from "./usage.js";
import { limitsFromEnv } from "./ingest/limits.js";
import { createIngestApp } from "./ingest/api.js";
import { startSweep } from "./ingest/processor.js";
import { MemoryStore, PgStore } from "./ingest/store.js";
import { mediaFromEnv } from "./outputs/render/media.js";
import { produceOutputs, startOutputSweep, toReadyArtifact } from "./outputs/run.js";
import { MemoryOutputStore, PgOutputStore } from "./outputs/store.js";

const app = createApp({ webOrigins: parseOrigins(process.env.WEB_ORIGINS) });
setUsageSink((u) => console.log(`[usage] ${JSON.stringify(u)}`));

// Ingestion (workflow 1) runs on Node only: it needs pg and requests that outlive a Worker's limits.
// It spends provider keys, so it is mounted only when GEMINI_API_KEY is set, and then INGEST_TOKEN is required:
// callers must send it as a Bearer token (the web Worker sends its PROCESSOR_TOKEN, which must equal this).
// DATABASE_URL selects Postgres and enables the pending-unit sweep; otherwise records stay in memory.
if (process.env.GEMINI_API_KEY) {
  const token = process.env.INGEST_TOKEN;
  if (!token) throw new Error("INGEST_TOKEN is required when ingestion is enabled");
  const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
  const options = {
    token,
    geminiKey: process.env.GEMINI_API_KEY,
    twitterApiKey: process.env.TWITTERAPI_IO_KEY,
    geminiModel: process.env.GEMINI_MODEL,
    windowSeconds: process.env.WINDOW_SECONDS ? Number(process.env.WINDOW_SECONDS) : undefined,
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    openaiMaxOutputTokens: process.env.OPENAI_MAX_OUTPUT_TOKENS ? Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) : undefined,
    categorizationRequest: process.env.DIGESTION_REQUEST,
    // A hard cap on provider spend: new units per UTC day and month across all users (DAILY_/MONTHLY_VIDEO_LIMIT).
    limits: limitsFromEnv(),
    devImports: process.env.ENABLE_DEV_IMPORTS === "1",
    store: pool ? new PgStore(pool) : new MemoryStore(),
    log: (m: string) => console.log(`[ingest] ${m}`),
  };
  // Each ready artifact gets a skill with tasks and a rendered short (src/outputs). Renders need ffmpeg on
  // this host and media storage: R2_* for the bucket, or MEDIA_LOCAL_WEB_DIR for local wrangler dev.
  const outputs = {
    outputs: pool ? new PgOutputStore(pool) : new MemoryOutputStore(),
    openaiKey: options.openaiKey,
    openaiModel: options.openaiModel,
    geminiKey: options.geminiKey,
    ttsModel: process.env.GEMINI_TTS_MODEL,
    ttsVoice: process.env.GEMINI_TTS_VOICE,
    media: mediaFromEnv(),
    log: (m: string) => console.log(`[outputs] ${m}`),
  };
  const processor = { ...options, onArtifacts: (a: StoredArtifact[]) => produceOutputs(a.map(toReadyArtifact), outputs) };
  app.route("/api/ingest", createIngestApp(processor));
  const interval = Number(process.env.SWEEP_INTERVAL_MS ?? 60_000);
  if (pool) {
    startSweep(processor, interval);
    startOutputSweep(outputs, interval);
  }
  console.log(`Processing limits: ${options.limits.daily} new units a day, ${options.limits.monthly} a month (UTC)`);
  console.log(`Ingestion mounted at /api/ingest (${pool ? "Postgres, sweeping pending units and outputs" : "in-memory"}); ` +
    `media: ${outputs.media ? outputs.media.constructor.name : "not configured, renders will fail with that reason"}`);
}

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Resurface API on http://localhost:${info.port}`);
});
