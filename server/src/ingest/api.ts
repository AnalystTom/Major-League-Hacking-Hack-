import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { MAX_WINDOW_SECONDS, MIN_WINDOW_SECONDS } from "./extract/gemini.js";
import { digestAndStore, ingestLink, type IngestOptions } from "./pipeline.js";
import type { ProjectContext } from "./digest/prompt.js";
import type { DigestOutput, IngestedUnit, StoredArtifact } from "./types.js";

interface ImportJob {
  id: string;
  request: string;
  units: IngestedUnit[];
  digest: {
    status: "skipped" | "pending" | "running" | "ready" | "failed";
    error: string | null;
    result: DigestOutput | null;
    /** artifact rows as written to the store; null until saved */
    /** digestion_prompts.id of the revision used; null until registered */
    digestion_prompt_id: string | null;
    stored_artifacts: StoredArtifact[] | null;
    store_error: string | null;
  };
}

export interface ApiOptions extends IngestOptions {
  context: ProjectContext;
  openaiKey?: string;
  openaiModel?: string;
}

const MAX_LINKS = 20;
const EMPTY_DIGEST = { error: null, result: null, digestion_prompt_id: null, stored_artifacts: null, store_error: null } as const;

function view(job: ImportJob) {
  return {
    id: job.id,
    links: job.units.map((u) => ({ id: u.id, submitted_url: u.submittedUrl, source_url: u.sourceUrl, start_seconds: u.startSeconds, status: u.status, error: u.error,
      title: u.title, extraction_method: u.extractionMethod, extracted_at: u.extractedAt,
      // API-only: the unreviewed model extraction (ingested_units.transcript) and items validation dropped.
      extraction: u.transcript,
      rejected_items: (u.rejectedItems ?? []).map((r) => ({ ...r.item, reason: r.reason })),
    })),
    digest: job.digest,
  };
}

/** Node-only ingestion routes (they use pg and long-running requests); mounted by src/index.ts, not the Worker. */
export function createIngestApp(o: ApiOptions): Hono {
  const jobs = new Map<string, ImportJob>();

  async function run(job: ImportJob, links: string[], windowSeconds: number | undefined) {
    await Promise.all(links.map(async (l, i) => { job.units[i] = await ingestLink(l, { ...o, windowSeconds: windowSeconds ?? o.windowSeconds }, (u) => { job.units[i] = u; }); }));
    const ready = job.units.filter((u) => u.status === "ready");
    if (!o.openaiKey) { job.digest = { ...EMPTY_DIGEST, status: "skipped", error: "OPENAI_API_KEY not configured" }; return; }
    if (ready.length === 0) { job.digest = { ...EMPTY_DIGEST, status: "skipped", error: "no successfully extracted sources" }; return; }
    job.digest.status = "running";
    try {
      const d = await digestAndStore({ apiKey: o.openaiKey, model: o.openaiModel, units: ready, request: job.request, context: o.context, fetchImpl: o.fetchImpl, store: o.store });
      job.digest = { status: "ready", error: null, result: d.result, digestion_prompt_id: d.promptId, stored_artifacts: d.stored, store_error: d.storeError };
    } catch (e) {
      job.digest = { ...EMPTY_DIGEST, status: "failed", error: (e as Error).message };
    }
  }

  const app = new Hono();

  app.post("/imports", async (c) => {
    const raw = await c.req.text();
    if (raw.length > 100_000) return c.json({ error: "body too large" }, 413);
    let body: { links?: unknown; request?: unknown; window_seconds?: unknown };
    try { body = JSON.parse(raw); } catch { return c.json({ error: "invalid JSON" }, 400); }
    if (!Array.isArray(body.links) || body.links.length === 0 || body.links.length > MAX_LINKS || !body.links.every((l) => typeof l === "string"))
      return c.json({ error: `links must be 1-${MAX_LINKS} strings` }, 400);
    if (typeof body.request !== "string" || !body.request.trim()) return c.json({ error: "request (Digestion Prompt text) is required" }, 400);
    const ws = body.window_seconds;
    if (ws !== undefined && (!Number.isInteger(ws) || (ws as number) < MIN_WINDOW_SECONDS || (ws as number) > MAX_WINDOW_SECONDS))
      return c.json({ error: `window_seconds must be an integer ${MIN_WINDOW_SECONDS}-${MAX_WINDOW_SECONDS}` }, 400);
    const links = body.links as string[];
    const job: ImportJob = {
      id: randomUUID(), request: body.request,
      units: links.map((l) => ({ id: randomUUID(), submittedUrl: l, sourceUrl: l, startSeconds: null, title: null, transcript: null, extractionMethod: null, extractedAt: null, status: "pending", error: null })),
      digest: { ...EMPTY_DIGEST, status: "pending" },
    };
    jobs.set(job.id, job);
    void run(job, links, ws as number | undefined);
    return c.json(view(job), 202);
  });

  app.get("/imports/:id", (c) => {
    const job = jobs.get(c.req.param("id"));
    return job ? c.json(view(job)) : c.json({ error: "unknown import" }, 404);
  });

  return app;
}
