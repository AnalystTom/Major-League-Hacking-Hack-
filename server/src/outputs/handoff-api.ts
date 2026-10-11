// POST /api/ingest/handoff { brief_id }: the web Worker asks for the agent prompt it just queued in agent_briefs.
// Answers 202 at once; the brief turns ready with every agent's prompt, or failed with the actual error.

import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { z } from "zod";
import { recordError, tracked } from "../activity.js";
import { HANDOFF_PROMPT_REVISION, refineHandoff, renderAllPrompts } from "./handoff.js";
import type { BriefClaim, HandoffStore } from "./handoff-store.js";

export interface HandoffOptions {
  token: string;
  store: HandoffStore;
  openaiKey?: string;
  openaiModel?: string;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/** Claims one brief and writes its result. Never throws; returns what happened. */
export async function runHandoff(briefId: string, o: HandoffOptions): Promise<"ready" | "failed" | "not_claimed"> {
  let claimed: BriefClaim | null;
  try {
    claimed = await o.store.claim(briefId);
  } catch (e) {
    // Nothing was claimed, so the brief stays pending and the page can ask again.
    o.log?.(`handoff ${briefId} couldn't be claimed: ${(e as Error).message}`);
    return "not_claimed";
  }
  if (!claimed) return "not_claimed";
  try {
    if (!o.openaiKey) throw new Error("OPENAI_API_KEY isn't configured on the processor");
    const skills = await o.store.loadSkills(claimed.skill_result_ids);
    if (skills.length !== claimed.skill_result_ids.length) {
      throw new Error(`${claimed.skill_result_ids.length - skills.length} of the selected skills aren't ready any more`);
    }
    const brief = await refineHandoff(skills, { apiKey: o.openaiKey, model: o.openaiModel, fetchImpl: o.fetchImpl });
    if (!(await o.store.finish(claimed, brief, renderAllPrompts(brief, skills), HANDOFF_PROMPT_REVISION))) {
      o.log?.(`handoff ${briefId} was taken over by a newer worker; this result was not saved`);
      return "not_claimed";
    }
    o.log?.(`handoff ${briefId} ready (${skills.length} skills, ${brief.actions.length} actions)`);
    return "ready";
  } catch (e) {
    await o.store.fail(claimed, (e as Error).message).catch(() => false);
    o.log?.(`handoff ${briefId} failed: ${(e as Error).message}`);
    return "failed";
  }
}

const Request = z.object({ brief_id: z.string().uuid() });

export function createHandoffApp(o: HandoffOptions): Hono {
  if (!o.token) throw new Error("INGEST_TOKEN is required");
  const app = new Hono();
  app.use("*", bearerAuth({ token: o.token }));
  app.post("/", async (c) => {
    const parsed = Request.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Send { brief_id }." }, 400);
    // Counted in /health's busy count, so a host that sleeps idle containers waits for the brief.
    tracked(() => runHandoff(parsed.data.brief_id, o)).catch((e: Error) => { recordError("handoff crashed", e); o.log?.(`handoff ${parsed.data.brief_id} crashed: ${e.message}`); });
    return c.json({ accepted: true }, 202);
  });
  return app;
}
