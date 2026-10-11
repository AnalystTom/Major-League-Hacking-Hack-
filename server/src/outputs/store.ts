// Reads ready artifacts and writes the processor's outputs: video_results (workflow 2), skill_results and
// action_items (workflow 3). Needs db/migrations/005_outputs.sql for the one-result-per-revision keys.

import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { GeneratedSkill, ReadyArtifact, RenderedVideo } from "./types.js";

export type Kind = "skill" | "video";

/**
 * A claimed `running` row older than this is treated as abandoned by a crashed processor. A render's worst case
 * (script, six narrated scenes with retries, ffmpeg, three uploads) stays well inside it.
 */
export const STALE_MINUTES = 60;

/** The row a worker holds, and the token that proves it still holds it. */
export interface Claim { id: string; token: string }

/** Thrown when a worker finishes after its claim went stale and someone else took the work over. */
export class LostClaim extends Error {
  constructor(kind: Kind) { super(`this ${kind} was taken over by a newer worker; its result was not saved`); }
}

export interface OutputStore {
  /** Ready digests of imported units with no result of this kind yet, or whose claim went stale. */
  artifactsNeeding(kind: Kind, limit: number): Promise<ReadyArtifact[]>;
  /** Takes the one result row for this revision as `running`; null when someone else holds it or it's settled. */
  claim(kind: Kind, a: ReadyArtifact): Promise<Claim | null>;
  /** Records a failure while the claim is still held; returns false when it was taken over. */
  fail(kind: Kind, c: Claim, error: string): Promise<boolean>;
  /** Save the result; throw LostClaim if the claim was taken over. */
  finishSkill(c: Claim, s: GeneratedSkill): Promise<void>;
  finishVideo(c: Claim, v: RenderedVideo): Promise<void>;
}

const TABLE: Record<Kind, string> = { skill: "skill_results", video: "video_results" };

function rowToArtifact(r: any): ReadyArtifact {
  return {
    id: r.id, version: r.version, name: r.name, category: r.category, processed_text: r.processed_text,
    selection_reason: r.selection_reason, source_ids: r.source_ids,
    sources: (r.sources ?? []).map((s: any) => ({ url: s.url, title: s.title ?? null })), evidence: r.evidence ?? [],
  };
}

export class PgOutputStore implements OutputStore {
  constructor(private pool: pg.Pool) {}

  async artifactsNeeding(kind: Kind, limit: number) {
    // digestion_prompt_id marks a real Digestion Prompt artifact (simulated dev rows have none).
    const { rows } = await this.pool.query(
      `SELECT a.id, a.version, a.name, a.category, a.processed_text, a.selection_reason, a.source_ids, a.sources, a.evidence
       FROM artifacts a
       WHERE a.ingestion_status = 'ready' AND a.digestion_prompt_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM user_imports ui WHERE ui.unit_id = ANY (a.source_ids))
         AND NOT EXISTS (SELECT 1 FROM ${TABLE[kind]} r WHERE r.artifact_id = a.id AND r.artifact_version = a.version
                         AND NOT (r.status = 'pending' OR (r.status = 'running' AND r.updated_at < now() - make_interval(mins => $2))))
       ORDER BY a.created_at LIMIT $1`, [limit, STALE_MINUTES]);
    return rows.map(rowToArtifact);
  }

  async claim(kind: Kind, a: ReadyArtifact) {
    const t = TABLE[kind];
    const { rows } = await this.pool.query(
      `INSERT INTO ${t} (artifact_id, artifact_version, status, updated_at, claim_token) VALUES ($1, $2, 'running', now(), gen_random_uuid())
       ON CONFLICT (artifact_id, artifact_version) DO UPDATE SET status = 'running', error = NULL, updated_at = now(), claim_token = gen_random_uuid()
       WHERE ${t}.status = 'pending' OR (${t}.status = 'running' AND ${t}.updated_at < now() - make_interval(mins => $3))
       RETURNING id, claim_token`, [a.id, a.version, STALE_MINUTES]);
    return rows[0] ? { id: rows[0].id as string, token: rows[0].claim_token as string } : null;
  }

  async fail(kind: Kind, c: Claim, error: string) {
    const { rowCount } = await this.pool.query(
      `UPDATE ${TABLE[kind]} SET status = 'failed', error = $3, updated_at = now() WHERE id = $1 AND claim_token = $2 AND status = 'running'`,
      [c.id, c.token, error.slice(0, 2000)]);
    return rowCount === 1;
  }

  async finishSkill(c: Claim, s: GeneratedSkill) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Settling the row first takes its lock, so a worker taking over waits and then sees it's done.
      const { rowCount } = await client.query(
        `UPDATE skill_results SET status = 'ready', skill_markdown = $3, supporting_refs = $4, error = NULL, updated_at = now()
         WHERE id = $1 AND claim_token = $2 AND status = 'running'`,
        [c.id, c.token, s.skill_markdown, JSON.stringify(s.supporting_refs)]);
      if (rowCount !== 1) throw new LostClaim("skill");
      const id = c.id;
      await client.query(`DELETE FROM action_items WHERE skill_result_id = $1`, [id]);
      for (const [position, item] of s.action_items.entries()) {
        await client.query(
          `INSERT INTO action_items (skill_result_id, task, applicability_evidence, prerequisites, steps, source_refs, completion_check, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, item.task, JSON.stringify(item.applicability_evidence), JSON.stringify(item.prerequisites), JSON.stringify(item.steps),
           JSON.stringify(item.source_refs), item.completion_check, position]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async finishVideo(c: Claim, v: RenderedVideo) {
    const { rowCount } = await this.pool.query(
      `UPDATE video_results SET status = 'ready', script = $3, opus_prompt_revision = $4, media_ref = $5, caption_ref = $6,
         narration_ref = $7, duration_seconds = $8, error = NULL, updated_at = now()
       WHERE id = $1 AND claim_token = $2 AND status = 'running'`,
      [c.id, c.token, JSON.stringify(v.script), v.prompt_revision, v.media_ref, v.caption_ref, v.narration_ref, v.duration_seconds]);
    if (rowCount !== 1) throw new LostClaim("video");
  }
}

type Row = { id: string; token: string; artifact: ReadyArtifact; status: "running" | "ready" | "failed"; error: string | null; value?: unknown };

/** In-memory stand-in for tests and runs without DATABASE_URL. */
export class MemoryOutputStore implements OutputStore {
  artifacts: ReadyArtifact[] = [];
  rows: Record<Kind, Map<string, Row>> = { skill: new Map(), video: new Map() };
  private key = (a: ReadyArtifact) => `${a.id}:${a.version}`;

  async artifactsNeeding(kind: Kind, limit: number) {
    return this.artifacts.filter((a) => !this.rows[kind].has(this.key(a))).slice(0, limit);
  }
  async claim(kind: Kind, a: ReadyArtifact) {
    if (this.rows[kind].has(this.key(a))) return null;
    const row: Row = { id: randomUUID(), token: randomUUID(), artifact: a, status: "running", error: null };
    this.rows[kind].set(this.key(a), row);
    return { id: row.id, token: row.token };
  }
  /** Test hook: what a newer worker's claim does to a stale row. */
  takeOver(kind: Kind, id: string) { this.held(kind, { id, token: "" }, true)!.token = randomUUID(); }
  private held(kind: Kind, c: Claim, any = false) {
    return [...this.rows[kind].values()].find((r) => r.id === c.id && (any || (r.token === c.token && r.status === "running")));
  }
  async fail(kind: Kind, c: Claim, error: string) {
    const row = this.held(kind, c);
    if (row) Object.assign(row, { status: "failed", error });
    return !!row;
  }
  async finishSkill(c: Claim, s: GeneratedSkill) {
    const row = this.held("skill", c);
    if (!row) throw new LostClaim("skill");
    Object.assign(row, { status: "ready", value: s });
  }
  async finishVideo(c: Claim, v: RenderedVideo) {
    const row = this.held("video", c);
    if (!row) throw new LostClaim("video");
    Object.assign(row, { status: "ready", value: v });
  }
}
