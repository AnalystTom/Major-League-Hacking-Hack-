import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MAX_WINDOW_SECONDS, MIN_WINDOW_SECONDS } from "./extract/gemini.js";
import { digestAndStore, ingestLink } from "./pipeline.js";
import { processUnits, type ProcessorOptions } from "./processor.js";
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

export interface ApiOptions extends ProcessorOptions {
  /** Bearer token callers must send; the web Worker sends its PROCESSOR_TOKEN. */
  token: string;
}

const Uuid = z.string().uuid();
// Unknown keys (an older caller's `project`) are stripped, not rejected.
const ProcessRequest = z.object({ unit_ids: z.array(Uuid).min(1).max(10) });

const MAX_LINKS = 20;
const EMPTY_DIGEST = { error: null, result: null, digestion_prompt_id: null, stored_artifacts: null, store_error: null } as const;

function view(job: ImportJob) {
  return {
    id: job.id,
    links: job.units.map((u) => ({ id: u.id, submitted_url: u.submittedUrl, source_url: u.sourceUrl, start_seconds: u.startSeconds, content_type: u.contentType, status: u.status, error: u.error,
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
  if (!o.token) throw new Error("INGEST_TOKEN is required");
  const jobs = new Map<string, ImportJob>();

  async function run(job: ImportJob, links: string[], windowSeconds: number | undefined) {
    await Promise.all(links.map(async (l, i) => {
      try {
        job.units[i] = await ingestLink(l, { ...o, windowSeconds: windowSeconds ?? o.windowSeconds }, (u) => { job.units[i] = u; });
      } catch (e) {
        job.units[i] = { ...job.units[i], status: "failed", error: (e as Error).message };
      }
    }));
    const ready = job.units.filter((u) => u.status === "ready");
    if (!o.openaiKey) { job.digest = { ...EMPTY_DIGEST, status: "skipped", error: "OPENAI_API_KEY not configured" }; return; }
    if (ready.length === 0) { job.digest = { ...EMPTY_DIGEST, status: "skipped", error: "no successfully extracted sources" }; return; }
    job.digest.status = "running";
    try {
      const d = await digestAndStore({ apiKey: o.openaiKey, model: o.openaiModel, maxOutputTokens: o.openaiMaxOutputTokens, units: ready, request: job.request, fetchImpl: o.fetchImpl, store: o.store });
      job.digest = { status: d.storeError ? "failed" : "ready", error: d.storeError, result: d.result, digestion_prompt_id: d.promptId, stored_artifacts: d.stored, store_error: d.storeError };
    } catch (e) {
      job.digest = { ...EMPTY_DIGEST, status: "failed", error: (e as Error).message };
    }
  }

  const app = new Hono();
  app.use("*", bearerAuth({ token: o.token }));

  // The processor contract: reply 202 quickly and work in the background. Duplicate requests are safe
  // because pending units are claimed atomically and digested units are skipped.
  app.post("/process", async (c) => {
    const raw = await c.req.text();
    if (raw.length > 100_000) return c.json({ error: "body too large" }, 413);
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return c.json({ error: "invalid JSON" }, 400); }
    const parsed = ProcessRequest.safeParse(json);
    if (!parsed.success) return c.json({ error: "expected { unit_ids: uuid[1-10] }" }, 400);
    const { unit_ids } = parsed.data;
    void processUnits(unit_ids, o)
      .then((s) => o.log?.(`processed ${unit_ids.length} unit(s): ${JSON.stringify(s)}`))
      .catch((e: Error) => o.log?.(`processing failed: ${e.message}`));
    return c.json({ accepted: unit_ids.length }, 202);
  });

  app.post("/imports", async (c) => {
    const raw = await c.req.text();
    if (raw.length > 100_000) return c.json({ error: "body too large" }, 413);
    let body: { links?: unknown; request?: unknown; window_seconds?: unknown };
    try { body = JSON.parse(raw); } catch { return c.json({ error: "invalid JSON" }, 400); }
    if (!body || typeof body !== "object") return c.json({ error: "body must be an object" }, 400);
    if (!Array.isArray(body.links) || body.links.length === 0 || body.links.length > MAX_LINKS || !body.links.every((l) => typeof l === "string"))
      return c.json({ error: `links must be 1-${MAX_LINKS} strings` }, 400);
    if (typeof body.request !== "string" || !body.request.trim()) return c.json({ error: "request (Digestion Prompt text) is required" }, 400);
    const ws = body.window_seconds;
    if (ws !== undefined && (!Number.isInteger(ws) || (ws as number) < MIN_WINDOW_SECONDS || (ws as number) > MAX_WINDOW_SECONDS))
      return c.json({ error: `window_seconds must be an integer ${MIN_WINDOW_SECONDS}-${MAX_WINDOW_SECONDS}` }, 400);
    const links = body.links as string[];
    const job: ImportJob = {
      id: randomUUID(), request: body.request,
      units: links.map((l) => ({ id: randomUUID(), submittedUrl: l, sourceUrl: l, startSeconds: null, title: null, contentType: "youtube_video", transcript: null, extractionMethod: null, extractedAt: null, status: "pending", error: null })),
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
