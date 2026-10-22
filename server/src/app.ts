// The Resurface API. Uses only web-standard APIs so it runs unchanged on Node and Cloudflare Workers.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { AGENTS, exportShort, isAgentId } from "./agents.js";
import { type Short } from "./shorts.js";
import { busyCount, lastErrorSeen } from "./activity.js";

export type AppConfig = {
  /** Browser origins allowed to call the API, e.g. the landing site. */
  webOrigins: string[];
  shorts?: Short[];
  /** The processor's INGEST_TOKEN: /health includes last_error only for callers presenting it. */
  healthToken?: string;
};

export function createApp({ webOrigins, shorts = [], healthToken }: AppConfig) {
  const app = new Hono();

  app.use("/api/*", cors({ origin: webOrigins }));

  // busy: imports being processed plus skills and shorts running or queued; 0 means the process may sleep.
  app.get("/health", (c) => {
    const authorized = !!healthToken && c.req.header("authorization") === `Bearer ${healthToken}`;
    return c.json(authorized ? { ok: true, busy: busyCount(), last_error: lastErrorSeen() } : { ok: true, busy: busyCount() });
  });

  app.get("/api/agents", (c) =>
    c.json(Object.entries(AGENTS).map(([id, a]) => ({ id, name: a.name })))
  );

  app.get("/api/shorts", (c) => c.json(shorts));

  app.get("/api/shorts/:id", (c) => {
    const short = shorts.find((s) => s.id === c.req.param("id"));
    return short ? c.json(short) : c.json({ error: "No short with that id." }, 404);
  });

  // The file a short becomes for one agent: its path in the repo and the Markdown to write there.
  app.get("/api/shorts/:id/export", (c) => {
    const short = shorts.find((s) => s.id === c.req.param("id"));
    if (!short) return c.json({ error: "No short with that id." }, 404);
    const agent = c.req.query("agent") ?? "claude";
    if (!isAgentId(agent)) {
      return c.json({ error: `Unknown agent. Use one of: ${Object.keys(AGENTS).join(", ")}.` }, 400);
    }
    return c.json(exportShort(short, agent));
  });

  app.notFound((c) => c.json({ error: "Not found." }, 404));

  return app;
}

/** Comma-separated origins from an env var, with the deployed landing site as the default. */
export const parseOrigins = (value: string | undefined) =>
  (value ?? "https://resurface.thomasmann2001.workers.dev,http://localhost:8787")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
