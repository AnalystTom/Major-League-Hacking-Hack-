// Node entry point: `npm run dev` locally, or `npm run build && npm start` on any Node host.

import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp, parseOrigins } from "./app.js";
import { createIngestApp } from "./ingest/api.js";
import { startSweep } from "./ingest/processor.js";
import { MemoryStore, PgStore } from "./ingest/store.js";

const app = createApp({ webOrigins: parseOrigins(process.env.WEB_ORIGINS) });

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
    categorizationRequest: process.env.DIGESTION_REQUEST,
    store: pool ? new PgStore(pool) : new MemoryStore(),
    log: (m: string) => console.log(`[ingest] ${m}`),
  };
  app.route("/api/ingest", createIngestApp(options));
  if (pool) startSweep(options, Number(process.env.SWEEP_INTERVAL_MS ?? 60_000));
  console.log(`Ingestion mounted at /api/ingest (${pool ? "Postgres, sweeping pending units" : "in-memory"})`);
}

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Resurface API on http://localhost:${info.port}`);
});
