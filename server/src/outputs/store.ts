// Reads ready artifacts and writes the processor's outputs: video_results (workflow 2), skill_results and
// action_items (workflow 3). Needs db/migrations/005_outputs.sql for the one-result-per-revision keys.

import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { GeneratedSkill, ReadyArtifact, RenderedVideo } from "./types.js";

export type Kind = "skill" | "video";

/** A claimed `running` row older than this is treated as abandoned by a crashed processor. */
export const STALE_MINUTES = 30;

export interface OutputStore {
  /** Ready digests of imported units with no result of this kind yet, or whose claim went stale. */
  artifactsNeeding(kind: Kind, limit: number): Promise<ReadyArtifact[]>;
  /** Takes the one result row for this revision as `running`; null when someone else holds it or it's settled. */
  claim(kind: Kind, a: ReadyArtifact): Promise<string | null>;
  fail(kind: Kind, id: string, error: string): Promise<void>;
  finishSkill(id: string, s: GeneratedSkill): Promise<void>;
  finishVideo(id: string, v: RenderedVideo): Promise<void>;
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
      `INSERT INTO ${t} (artifact_id, artifact_version, status, updated_at) VALUES ($1, $2, 'running', now())
       ON CONFLICT (artifact_id, artifact_version) DO UPDATE SET status = 'running', error = NULL, updated_at = now()
       WHERE ${t}.status = 'pending' OR (${t}.status = 'running' AND ${t}.updated_at < now() - make_interval(mins => $3))
       RETURNING id`, [a.id, a.version, STALE_MINUTES]);
    return (rows[0]?.id as string | undefined) ?? null;
  }

  async fail(kind: Kind, id: string, error: string) {
    await this.pool.query(`UPDATE ${TABLE[kind]} SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [id, error.slice(0, 2000)]);
  }

  async finishSkill(id: string, s: GeneratedSkill) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM action_items WHERE skill_result_id = $1`, [id]);
      for (const [position, item] of s.action_items.entries()) {
        await client.query(
          `INSERT INTO action_items (skill_result_id, task, applicability_evidence, prerequisites, steps, source_refs, completion_check, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, item.task, JSON.stringify(item.applicability_evidence), JSON.stringify(item.prerequisites), JSON.stringify(item.steps),
           JSON.stringify(item.source_refs), item.completion_check, position]);
      }
      await client.query(
        `UPDATE skill_results SET status = 'ready', skill_markdown = $2, supporting_refs = $3, error = NULL, updated_at = now() WHERE id = $1`,
        [id, s.skill_markdown, JSON.stringify(s.supporting_refs)]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async finishVideo(id: string, v: RenderedVideo) {
    await this.pool.query(
      `UPDATE video_results SET status = 'ready', script = $2, opus_prompt_revision = $3, media_ref = $4, caption_ref = $5,
         narration_ref = $6, duration_seconds = $7, error = NULL, updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(v.script), v.prompt_revision, v.media_ref, v.caption_ref, v.narration_ref, v.duration_seconds]);
  }
}

type Row = { id: string; artifact: ReadyArtifact; status: "running" | "ready" | "failed"; error: string | null; value?: unknown };

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
    const row: Row = { id: randomUUID(), artifact: a, status: "running", error: null };
    this.rows[kind].set(this.key(a), row);
    return row.id;
  }
  private byId(kind: Kind, id: string) { return [...this.rows[kind].values()].find((r) => r.id === id)!; }
  async fail(kind: Kind, id: string, error: string) { Object.assign(this.byId(kind, id), { status: "failed", error }); }
  async finishSkill(id: string, s: GeneratedSkill) { Object.assign(this.byId("skill", id), { status: "ready", value: s }); }
  async finishVideo(id: string, v: RenderedVideo) { Object.assign(this.byId("video", id), { status: "ready", value: v }); }
}
