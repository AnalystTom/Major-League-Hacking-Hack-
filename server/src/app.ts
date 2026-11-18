import { Hono } from "hono";
import { cors } from "hono/cors";
import { AGENTS, exportShort, isAgentId } from "./agents.js";
import { type Short } from "./shorts.js";
import { busyCount, lastErrorSeen } from "./activity.js";
import { constantTimeEqual } from "./constantTime.js";

export type AppConfig = {
  webOrigins: string[];
  shorts?: Short[];
  healthToken?: string;
};

export function createApp({ webOrigins, shorts = [], healthToken }: AppConfig) {
  const app = new Hono();

  app.use("/api/*", cors({ origin: webOrigins }));

  app.get("/health", (c) => {
    const authorized = !!healthToken && constantTimeEqual(c.req.header("authorization") ?? "", `Bearer ${healthToken}`);
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

export const parseOrigins = (value: string | undefined) =>
  (value ?? "https://resurface.thomasmann2001.workers.dev")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
