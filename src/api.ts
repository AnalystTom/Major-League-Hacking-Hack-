import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { ingestLink, type IngestOptions } from "./pipeline.ts";
import { runDigestion } from "./digest/run.ts";
import type { ProjectContext } from "./digest/prompt.ts";
import type { DigestOutput, IngestedUnit } from "./types.ts";

interface ImportJob {
  id: string;
  request: string;
  units: IngestedUnit[];
  digest: {
    status: "skipped" | "pending" | "running" | "ready" | "failed";
    error: string | null;
    result: DigestOutput | null;
    /** ids of artifacts written to the store; null until saved */
    stored_artifact_ids: string[] | null;
    store_error: string | null;
  };
}

export interface ApiOptions extends IngestOptions {
  context: ProjectContext;
  anthropicKey?: string;
}

const MAX_LINKS = 20;
const EMPTY_DIGEST = { error: null, result: null, stored_artifact_ids: null, store_error: null } as const;

function view(job: ImportJob) {
  return {
    id: job.id,
    links: job.units.map((u) => ({ id: u.id, submitted_url: u.submittedUrl, source_url: u.sourceUrl, start_seconds: u.startSeconds, status: u.status, error: u.error,
      // Unreviewed model extraction: check against the video before treating as approved.
      review_status: "pending",
      extraction: u.transcript,
      rejected_items: (u.rejectedItems ?? []).map((r) => ({ ...r.item, reason: r.reason })),
    })),
    digest: job.digest,
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 100_000) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createApi(o: ApiOptions): Server {
  const jobs = new Map<string, ImportJob>();

  async function run(job: ImportJob, links: string[]) {
    await Promise.all(links.map(async (l, i) => { job.units[i] = await ingestLink(l, o, (u) => { job.units[i] = u; }); }));
    const ready = job.units.filter((u) => u.status === "ready");
    if (!o.anthropicKey) { job.digest = { ...EMPTY_DIGEST, status: "skipped", error: "ANTHROPIC_API_KEY not configured" }; return; }
    if (ready.length === 0) { job.digest = { ...EMPTY_DIGEST, status: "skipped", error: "no successfully extracted sources" }; return; }
    job.digest.status = "running";
    try {
      const result = await runDigestion({ apiKey: o.anthropicKey, units: ready, request: job.request, context: o.context, fetchImpl: o.fetchImpl });
      job.digest = { ...EMPTY_DIGEST, status: "ready", result };
      try {
        job.digest.stored_artifact_ids = await o.store.saveArtifacts(result.artifacts, result.exclusions, null);
      } catch (e) {
        job.digest.store_error = (e as Error).message;
      }
    } catch (e) {
      job.digest = { ...EMPTY_DIGEST, status: "failed", error: (e as Error).message };
    }
  }

  return createServer(async (req, res) => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "POST" && url.pathname === "/imports") {
        const body = (await readJson(req)) as { links?: unknown; request?: unknown };
        if (!Array.isArray(body.links) || body.links.length === 0 || body.links.length > MAX_LINKS || !body.links.every((l) => typeof l === "string"))
          return send(400, { error: `links must be 1-${MAX_LINKS} strings` });
        if (typeof body.request !== "string" || !body.request.trim()) return send(400, { error: "request (Digestion Prompt text) is required" });
        const links = body.links as string[];
        const job: ImportJob = {
          id: randomUUID(), request: body.request,
          units: links.map((l) => ({ id: randomUUID(), submittedUrl: l, sourceUrl: l, startSeconds: null, title: null, transcript: null, extractionMethod: null, extractedAt: null, status: "pending", error: null })),
          digest: { ...EMPTY_DIGEST, status: "pending" },
        };
        jobs.set(job.id, job);
        void run(job, links);
        return send(202, view(job));
      }
      const m = /^\/imports\/([\w-]+)$/.exec(url.pathname);
      if (req.method === "GET" && m) {
        const job = jobs.get(m[1]);
        return job ? send(200, view(job)) : send(404, { error: "unknown import" });
      }
      send(404, { error: "not found" });
    } catch (e) {
      send(400, { error: (e as Error).message });
    }
  });
}
