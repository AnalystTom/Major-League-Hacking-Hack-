// Reads ready artifacts and writes the processor's outputs: video_results (workflow 2), skill_results and
// action_items (workflow 3). Needs db/migrations/005_outputs.sql for the one-result-per-revision keys.

import { randomUUID } from "node:crypto";
import type pg from "pg";
import { STALE_CLAIM_MINUTES } from "../claims.js";
import { sourceRefs, type GeneratedSkill, type ReadyArtifact, type RenderedVideo } from "./types.js";
import type { SkillCard } from "./render/motion-skill.js";

export type Kind = "skill" | "video";

/** Claims per result before a failure is final; a provider outage or one invalid reply shouldn't be. */
export const MAX_OUTPUT_ATTEMPTS = 3;
/** A failed result waits this long times its attempts so far before it's tried again (5, then 10 minutes). */
export const RETRY_AFTER_MINUTES = 5;

/** A result row a worker may take: never started, abandoned by a crashed worker, or failed with attempts left. */
const CLAIMABLE = (r: string) => `(${r}.status = 'pending'
  OR (${r}.status = 'running' AND ${r}.updated_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}))
  OR (${r}.status = 'failed' AND ${r}.attempts < ${MAX_OUTPUT_ATTEMPTS}
      AND ${r}.updated_at < now() - make_interval(mins => ${RETRY_AFTER_MINUTES} * ${r}.attempts)))`;

/** The row a worker holds, and the token that proves it still holds it. */
export interface Claim { id: string; token: string }

/** Thrown when a worker finishes after its claim went stale and someone else took the work over. */
export class LostClaim extends Error {
  constructor(kind: Kind) { super(`this ${kind} was taken over by a newer worker; its result was not saved`); }
}

export interface OutputStore {
  /** Ready digests of imported units with no result of this kind yet, a stale claim, or a failure with attempts left. */
  artifactsNeeding(kind: Kind, limit: number): Promise<ReadyArtifact[]>;
  /** Takes the one result row for this revision as `running`; null when someone else holds it or it's settled. */
  claim(kind: Kind, a: ReadyArtifact): Promise<Claim | null>;
  /** Records a failure while the claim is still held; returns false when it was taken over. */
  fail(kind: Kind, c: Claim, error: string): Promise<boolean>;
  /** Save the result; throw LostClaim if the claim was taken over. */
  finishSkill(c: Claim, s: GeneratedSkill): Promise<void>;
  finishVideo(c: Claim, v: RenderedVideo): Promise<void>;
  /** This revision's skill as a short's end card names it: its state, and once ready its name and task count. */
  skillCard?(a: ReadyArtifact): Promise<SkillState>;
}

export type SkillState = { status: "none" | "pending" | "running" | "ready" | "failed"; card: SkillCard | null };

/** The `name:` line of a SKILL.md's frontmatter. */
export const skillNameOf = (markdown: string) => markdown.match(/^---\n(?:.*\n)*?name:\s*([a-z0-9-]+)\s*\n/)?.[1] ?? null;

const TABLE: Record<Kind, string> = { skill: "skill_results", video: "video_results" };

function rowToArtifact(r: any): ReadyArtifact {
  return {
    id: r.id, version: r.version, name: r.name, category: r.category, processed_text: r.processed_text,
    selection_reason: r.selection_reason, source_ids: r.source_ids,
    sources: sourceRefs(r.sources), evidence: r.evidence ?? [],
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
                         AND NOT ${CLAIMABLE("r")})
       ORDER BY a.created_at LIMIT $1`, [limit]);
    return rows.map(rowToArtifact);
  }

  async claim(kind: Kind, a: ReadyArtifact) {
    const t = TABLE[kind];
    const { rows } = await this.pool.query(
      `INSERT INTO ${t} (artifact_id, artifact_version, status, updated_at, claim_token, attempts) VALUES ($1, $2, 'running', now(), gen_random_uuid(), 1)
       ON CONFLICT (artifact_id, artifact_version) DO UPDATE SET status = 'running', error = NULL, updated_at = now(),
         claim_token = gen_random_uuid(), attempts = ${t}.attempts + 1
       WHERE ${CLAIMABLE(t)}
       RETURNING id, claim_token`, [a.id, a.version]);
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
         narration_ref = $7, duration_seconds = $8, music_provenance = $9, error = NULL, updated_at = now()
       WHERE id = $1 AND claim_token = $2 AND status = 'running'`,
      [c.id, c.token, JSON.stringify(v.script), v.prompt_revision, v.media_ref, v.caption_ref, v.narration_ref, v.duration_seconds, v.music_provenance ?? null]);
    if (rowCount !== 1) throw new LostClaim("video");
  }

  async skillCard(a: ReadyArtifact): Promise<SkillState> {
    const { rows } = await this.pool.query(
      `SELECT s.status, s.skill_markdown, (SELECT count(*)::int FROM action_items i WHERE i.skill_result_id = s.id) AS tasks
       FROM skill_results s WHERE s.artifact_id = $1 AND s.artifact_version = $2`, [a.id, a.version]);
    const r = rows[0];
    if (!r) return { status: "none", card: null };
    const name = r.status === "ready" ? skillNameOf(r.skill_markdown ?? "") : null;
    return { status: r.status, card: name ? { name, tasks: r.tasks } : null };
  }
}

type Row = {
  id: string; token: string; artifact: ReadyArtifact; status: "running" | "ready" | "failed"; error: string | null; value?: unknown;
  attempts: number; failedAt?: number;
};

/** In-memory stand-in for tests and runs without DATABASE_URL. */
export class MemoryOutputStore implements OutputStore {
  artifacts: ReadyArtifact[] = [];
  rows: Record<Kind, Map<string, Row>> = { skill: new Map(), video: new Map() };
  /** RETRY_AFTER_MINUTES in milliseconds; tests set 0. */
  constructor(private retryAfterMs = RETRY_AFTER_MINUTES * 60_000) {}
  private key = (a: ReadyArtifact) => `${a.id}:${a.version}`;
  private claimable = (r: Row | undefined) =>
    !r || (r.status === "failed" && r.attempts < MAX_OUTPUT_ATTEMPTS && Date.now() >= (r.failedAt ?? 0) + this.retryAfterMs * r.attempts);

  async artifactsNeeding(kind: Kind, limit: number) {
    return this.artifacts.filter((a) => this.claimable(this.rows[kind].get(this.key(a)))).slice(0, limit);
  }
  async claim(kind: Kind, a: ReadyArtifact) {
    const before = this.rows[kind].get(this.key(a));
    if (!this.claimable(before)) return null;
    const row: Row = { id: before?.id ?? randomUUID(), token: randomUUID(), artifact: a, status: "running", error: null, attempts: (before?.attempts ?? 0) + 1 };
    this.rows[kind].set(this.key(a), row);
    return { id: row.id, token: row.token };
  }
  private held(kind: Kind, c: Claim) {
    return [...this.rows[kind].values()].find((r) => r.id === c.id && r.token === c.token && r.status === "running");
  }
  async fail(kind: Kind, c: Claim, error: string) {
    const row = this.held(kind, c);
    if (row) Object.assign(row, { status: "failed", error, failedAt: Date.now() });
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
  async skillCard(a: ReadyArtifact): Promise<SkillState> {
    const row = this.rows.skill.get(this.key(a));
    if (!row) return { status: "none", card: null };
    const s = row.value as GeneratedSkill | undefined, name = row.status === "ready" && s ? skillNameOf(s.skill_markdown) : null;
    return { status: row.status, card: name ? { name, tasks: s!.action_items.length } : null };
  }
}
