// Writes video_results (workflow 2) and skill_results (workflow 3), preserving historical action_items.
// Needs db/migrations/005_outputs.sql for the one-result-per-revision keys.

import { assertJudged } from "./render/judge.js";
import { randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import { NOW } from "../ingest/ledger.js";
import { STALE_CLAIM_MINUTES } from "../claims.js";
import { sourceRefs, type GeneratedSkill, type ReadyArtifact, type RenderedVideo } from "./types.js";
import type { SkillCard } from "./render/motion-skill.js";
import { SKILL_PROMPT_REVISION } from "./skills.js";
import { VIDEO_GENERATOR_REVISION } from "./render/revision.js";

export type Kind = "skill" | "video";

/** Claims per result before a failure is final; a provider outage or one invalid reply shouldn't be. */
export const MAX_OUTPUT_ATTEMPTS = 3;
/** A failed result waits this long times its attempts so far before it's tried again (5, then 10 minutes). */
export const RETRY_AFTER_MINUTES = 5;

const feedback = (r: string) => `CASE WHEN json_valid(${r}.review_feedback)
  THEN CASE WHEN json_type(${r}.review_feedback)='object' THEN ${r}.review_feedback ELSE '{}' END ELSE '{}' END`;
const videoRefresh = (r: string) => `(${r}.status IN ('ready','failed') AND coalesce(json_extract(${feedback(r)},'$.generator_revision'),'') <> '${VIDEO_GENERATOR_REVISION}')`;
const regenerating = (r: string) => `coalesce(json_extract(${feedback(r)},'$.regenerating'),0)=1`;

/** Legacy outputs get one versioned attempt, without crash reclaim. Approved videos stay ready. */
const CLAIMABLE = (r: string, kind: Kind) => `(${r}.status = 'pending'
  OR ${kind === 'video' ? videoRefresh(r) : `(${r}.status='ready' AND coalesce(json_extract(${feedback(r)},'$.prompt_revision'),'') <> '${SKILL_PROMPT_REVISION}')`}
  OR (${r}.status = 'running' AND NOT (${regenerating(r)})
      AND julianday(${r}.updated_at) < julianday('now', '-${STALE_CLAIM_MINUTES} minutes'))
  OR (${r}.status = 'failed' AND ${r}.attempts < ${MAX_OUTPUT_ATTEMPTS}
      AND julianday(${r}.updated_at) < julianday('now', '-' || (${RETRY_AFTER_MINUTES} * ${r}.attempts) || ' minutes')))`;

/** The row a worker holds, and the token that proves it still holds it. */
export interface Claim { id: string; token: string }

/** Thrown when a worker finishes after its claim went stale and someone else took the work over. */
export class LostClaim extends Error {
  constructor(kind: Kind) { super(`this ${kind} was taken over by a newer worker; its result was not saved`); }
}

export interface OutputStore {
  /** Ready digests of imported units with no result of this kind yet, a stale claim, or a failure with attempts left. */
  artifactsNeeding(kind: Kind, limit: number): Promise<ReadyArtifact[]>;
  /** Claims generation; an approved video stays ready during its refresh. Null if already held or settled. */
  claim(kind: Kind, a: ReadyArtifact): Promise<Claim | null>;
  /** Records a failure while the claim is still held; returns false when it was taken over. */
  fail(kind: Kind, c: Claim, error: string): Promise<boolean>;
  /** Save the result; throw LostClaim if the claim was taken over. */
  finishSkill(c: Claim, s: GeneratedSkill): Promise<void>;
  finishVideo(c: Claim, v: RenderedVideo): Promise<void>;
  /** This revision's skill as a short's end card names it: its state, and once ready its name and description. */
  skillCard?(a: ReadyArtifact): Promise<SkillState>;
}

export type SkillState = { status: "none" | "pending" | "running" | "ready" | "failed"; card: SkillCard | null };

/** Only actual skill frontmatter can supply an end card. */
export function skillCardOf(markdown: string): SkillCard | null {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const name = frontmatter?.match(/^name:[ \t]*([a-z0-9-]+)[ \t]*\r?$/m)?.[1];
  let description: unknown = frontmatter?.match(/^description:[ \t]*(.+)$/m)?.[1]?.trim();
  if (typeof description === "string" && description.startsWith('"')) {
    try { description = JSON.parse(description); } catch { return null; }
  }
  if (!name || typeof description !== "string" || !description.trim()) return null;
  return { name, description: description.replace(/\s+/g, " ").trim() };
}

const TABLE: Record<Kind, string> = { skill: "skill_results", video: "video_results" };

function rowToArtifact(r: any): ReadyArtifact {
  return {
    id: r.id, version: r.version, name: r.name, category: r.category, processed_text: r.processed_text,
    selection_reason: r.selection_reason, source_ids: r.source_ids,
    sources: sourceRefs(r.sources), evidence: r.evidence ?? [],
  };
}

export class D1OutputStore implements OutputStore {
  constructor(private db: Database) {}
  async artifactsNeeding(kind: Kind, limit: number) {
    const { rows } = await this.db.query(`SELECT a.* FROM artifacts a
      WHERE a.ingestion_status='ready' AND a.digestion_prompt_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM user_imports ui WHERE ui.unit_id IN (SELECT value FROM json_each(a.source_ids)))
      AND NOT EXISTS(SELECT 1 FROM ${TABLE[kind]} r WHERE r.artifact_id=a.id AND r.artifact_version=a.version
        AND NOT ${CLAIMABLE('r',kind)}) ORDER BY a.created_at LIMIT ?1`, [limit]);
    return rows.map(rowToArtifact);
  }
  async claim(kind: Kind, a: ReadyArtifact) {
    const t = TABLE[kind];
    const { rows } = await this.db.query(`INSERT INTO ${t}(artifact_id,artifact_version,status,updated_at,claim_token,attempts,review_feedback)
      VALUES(?1,?2,'running',${NOW},?3,1,${kind === 'video' ? `json_object('generator_revision','${VIDEO_GENERATOR_REVISION}')` : 'NULL'})
      ON CONFLICT(artifact_id,artifact_version) DO UPDATE SET
        status=${kind === 'video' ? `CASE WHEN ${t}.status='ready' THEN 'ready' ELSE 'running' END` : "'running'"},error=NULL,updated_at=${NOW},
        review_feedback=${kind === 'skill' ? `CASE WHEN ${t}.status='ready' THEN '{"regenerating":true}' ELSE ${t}.review_feedback END` : `json_set(${feedback(t)},'$.generator_revision','${VIDEO_GENERATOR_REVISION}','$.regenerating',${videoRefresh(t)})`},
        claim_token=excluded.claim_token,attempts=${t}.attempts+1
      WHERE ${CLAIMABLE(t,kind)} RETURNING id,claim_token`,[a.id,a.version,randomUUID()]);
    return rows[0] ? { id: rows[0].id as string,token: rows[0].claim_token as string } : null;
  }
  async fail(kind: Kind, c: Claim, error: string) {
    const t = TABLE[kind];
    const { rowCount } = await this.db.query(`UPDATE ${t} SET status=CASE WHEN status='ready' THEN 'ready' ELSE 'failed' END,
      error=?3,claim_token=NULL,attempts=CASE WHEN ?3 LIKE 'Quality judge rejected:%' OR ${regenerating(t)}
      THEN max(attempts,${MAX_OUTPUT_ATTEMPTS}) ELSE attempts END,updated_at=${NOW}
      WHERE id=?1 AND claim_token=?2 AND (status='running' ${kind === 'video' ? `OR (status='ready' AND ${regenerating(t)})` : ''})`,[c.id,c.token,error.slice(0,2000)]);
    return rowCount===1;
  }
  async finishSkill(c: Claim, s: GeneratedSkill) {
    const { rowCount } = await this.db.query(`UPDATE skill_results SET status='ready',skill_markdown=?3,supporting_refs=?4,review_feedback=?5,error=NULL,updated_at=${NOW}
      WHERE id=?1 AND claim_token=?2 AND status='running'`, [c.id,c.token,s.skill_markdown,JSON.stringify(s.supporting_refs),JSON.stringify({prompt_revision:SKILL_PROMPT_REVISION})]);
    if (rowCount!==1) throw new LostClaim('skill');
  }

  async finishVideo(c: Claim, v: RenderedVideo) {
    assertJudged(v.judgment);
    const { rowCount } = await this.db.query(`UPDATE video_results SET status='ready',claim_token=NULL,script=?3,opus_prompt_revision=?4,
      media_ref=?5,caption_ref=?6,narration_ref=?7,duration_seconds=?8,music_provenance=?9,review_status='approved',review_feedback=?10,error=NULL,updated_at=${NOW}
      WHERE id=?1 AND claim_token=?2 AND (status='running' OR (status='ready' AND ${regenerating('video_results')}))`,
      [c.id,c.token,JSON.stringify(v.script),v.prompt_revision,v.media_ref,v.caption_ref,v.narration_ref,v.duration_seconds,v.music_provenance ?? null,JSON.stringify({...v.judgment,generator_revision:VIDEO_GENERATOR_REVISION})]);
    if (rowCount!==1) throw new LostClaim('video');
  }

  async skillCard(a: ReadyArtifact): Promise<SkillState> {
    const { rows } = await this.db.query(
      `SELECT s.status, s.skill_markdown,
        json_extract(iif(json_valid(s.review_feedback),s.review_feedback,'{}'),'$.prompt_revision') AS prompt_revision
       FROM skill_results s WHERE s.artifact_id = ?1 AND s.artifact_version = ?2`, [a.id, a.version]);
    const r = rows[0];
    if (!r) return { status: "none", card: null };
    const status = r.status === "ready" && r.prompt_revision !== SKILL_PROMPT_REVISION ? "pending" : r.status;
    return { status, card: status === "ready" ? skillCardOf(r.skill_markdown ?? "") : null };
  }
}

type Row = {
  id: string; token: string | null; artifact: ReadyArtifact; status: "running" | "ready" | "failed"; error: string | null; value?: unknown;
  attempts: number; failedAt?: number; promptRevision?: string; generatorRevision?: string; regenerating?: boolean;
};

/** In-memory stand-in for tests and runs without D1_URL. */
export class MemoryOutputStore implements OutputStore {
  artifacts: ReadyArtifact[] = [];
  rows: Record<Kind, Map<string, Row>> = { skill: new Map(), video: new Map() };
  /** RETRY_AFTER_MINUTES in milliseconds; tests set 0. */
  constructor(private retryAfterMs = RETRY_AFTER_MINUTES * 60_000) {}
  private key = (a: ReadyArtifact) => `${a.id}:${a.version}`;
  private claimable = (r: Row | undefined, kind: Kind) =>
    !r || (kind === "skill" && r.status === "ready" && r.promptRevision !== SKILL_PROMPT_REVISION)
      || (kind === "video" && (r.status === "ready" || r.status === "failed") && r.generatorRevision !== VIDEO_GENERATOR_REVISION)
      || (r.status === "failed" && r.attempts < MAX_OUTPUT_ATTEMPTS && Date.now() >= (r.failedAt ?? 0) + this.retryAfterMs * r.attempts);

  async artifactsNeeding(kind: Kind, limit: number) {
    return this.artifacts.filter((a) => this.claimable(this.rows[kind].get(this.key(a)), kind)).slice(0, limit);
  }
  async claim(kind: Kind, a: ReadyArtifact) {
    const before = this.rows[kind].get(this.key(a));
    if (!this.claimable(before, kind)) return null;
    const refresh = kind === "video" && !!before && (before.status === "ready" || before.status === "failed") && before.generatorRevision !== VIDEO_GENERATOR_REVISION;
    const token = randomUUID();
    const row: Row = { ...before, id: before?.id ?? randomUUID(), token, artifact: a,
      status: refresh && before?.status === "ready" ? "ready" : "running", error: null, attempts: (before?.attempts ?? 0) + 1,
      generatorRevision: kind === "video" ? VIDEO_GENERATOR_REVISION : before?.generatorRevision,
      regenerating: refresh || (kind === "skill" && before?.status === "ready") };
    this.rows[kind].set(this.key(a), row);
    return { id: row.id, token };
  }
  private held(kind: Kind, c: Claim) {
    return [...this.rows[kind].values()].find((r) => r.id === c.id && r.token !== null && r.token === c.token
      && (r.status === "running" || (kind === "video" && r.status === "ready" && r.regenerating)));
  }
  async fail(kind: Kind, c: Claim, error: string) {
    const row = this.held(kind, c);
    if (row) Object.assign(row, { status: row.status === "ready" ? "ready" : "failed", token: null, error, failedAt: Date.now(), ...(row.regenerating || error.startsWith("Quality judge rejected:") ? { attempts: Math.max(row.attempts,MAX_OUTPUT_ATTEMPTS) } : {}) });
    return !!row;
  }
  async finishSkill(c: Claim, s: GeneratedSkill) {
    const row = this.held("skill", c);
    if (!row) throw new LostClaim("skill");
    Object.assign(row, { status: "ready", value: s, promptRevision: SKILL_PROMPT_REVISION, regenerating: false });
  }
  async finishVideo(c: Claim, v: RenderedVideo) {
    const row = this.held("video", c);
    if (!row) throw new LostClaim("video");
    assertJudged(v.judgment);
    Object.assign(row, { status: "ready", value: v, token: null, generatorRevision: VIDEO_GENERATOR_REVISION, regenerating: false });
  }
  async skillCard(a: ReadyArtifact): Promise<SkillState> {
    const row = this.rows.skill.get(this.key(a));
    if (!row) return { status: "none", card: null };
    const status = row.status === "ready" && row.promptRevision !== SKILL_PROMPT_REVISION ? "pending" : row.status;
    const s = row.value as GeneratedSkill | undefined;
    return { status, card: status === "ready" && s ? skillCardOf(s.skill_markdown) : null };
  }
}
