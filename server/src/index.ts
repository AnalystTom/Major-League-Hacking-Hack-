// Node entry point: `npm run dev` locally, or `npm run build && npm start` on any Node host.

import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp, parseOrigins } from "./app.js";
import { createIngestApp } from "./ingest/api.js";
import { MemoryStore, PgStore } from "./ingest/store.js";

const app = createApp({ webOrigins: parseOrigins(process.env.WEB_ORIGINS) });

// Ingestion (workflow 1) runs on Node only: it needs pg and requests that outlive a Worker's limits.
// It is mounted when GEMINI_API_KEY is set. DATABASE_URL selects Postgres; otherwise records stay in memory.
if (process.env.GEMINI_API_KEY) {
  const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
  const context = JSON.parse(await readFile(process.env.PROJECT_CONTEXT ?? "config/project-context.placeholder.json", "utf8"));
  app.route("/api/ingest", createIngestApp({
    geminiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL,
    windowSeconds: process.env.WINDOW_SECONDS ? Number(process.env.WINDOW_SECONDS) : undefined,
    openaiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    store: pool ? new PgStore(pool) : new MemoryStore(),
    context,
  }));
  console.log(`Ingestion mounted at /api/ingest (${pool ? "Postgres" : "in-memory"} store)`);
}

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Resurface API on http://localhost:${info.port}`);
});
