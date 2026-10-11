// Node entry point: `npm run dev` locally, or `npm run build && npm start` on any Node host.

import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp, parseOrigins } from "./app.js";
import { createIngestApp } from "./ingest/api.js";
import { startSweep } from "./ingest/processor.js";
import { MemoryStore, PgStore } from "./ingest/store.js";

const app = createApp({ webOrigins: parseOrigins(process.env.WEB_ORIGINS) });

// Ingestion (workflow 1) runs on Node only: it needs pg and requests that outlive a Worker's limits.
// It spends provider keys, so it is mounted only with GEMINI_API_KEY and a PROCESSOR_TOKEN that callers
// must present as a Bearer token. DATABASE_URL selects Postgres (and enables the pending-unit sweep);
// otherwise records stay in memory.
if (process.env.GEMINI_API_KEY && process.env.PROCESSOR_TOKEN) {
  const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
  const context = JSON.parse(await readFile(process.env.PROJECT_CONTEXT ?? "config/project-context.placeholder.json", "utf8"));
  const options = {
    geminiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL,
    windowSeconds: process.env.WINDOW_SECONDS ? Number(process.env.WINDOW_SECONDS) : undefined,
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    categorizationRequest: process.env.DIGESTION_REQUEST,
    store: pool ? new PgStore(pool) : new MemoryStore(),
    context,
    token: process.env.PROCESSOR_TOKEN,
    log: (m: string) => console.log(`[ingest] ${m}`),
  };
  app.route("/api/ingest", createIngestApp(options));
  if (pool) startSweep(options, Number(process.env.SWEEP_INTERVAL_MS ?? 60_000));
  console.log(`Ingestion mounted at /api/ingest (${pool ? "Postgres, sweeping pending units" : "in-memory"})`);
} else if (process.env.GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is set but PROCESSOR_TOKEN is not; ingestion is NOT mounted.");
}

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Resurface API on http://localhost:${info.port}`);
});
