import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { DigestArtifact, IngestedUnit, StoredArtifact } from "./types.js";
import { STALE_CLAIM_MINUTES } from "../claims.js";

type Exclusion = { unit_id: string; reason: string };

/** Failed digests per unit before the sweep stops retrying it; the unit keeps showing the last error. */
export const MAX_DIGEST_ATTEMPTS = 3;

export interface Store {
  saveUnit(unit: IngestedUnit): Promise<void>;
  getUnits(ids: string[]): Promise<IngestedUnit[]>;
  listReadyUnits(): Promise<IngestedUnit[]>;
  /** Atomically moves pending units (optionally only these ids) to running and returns the ones this caller now owns. */
  claimPendingUnits(ids?: string[], limit?: number): Promise<IngestedUnit[]>;
  /** Pending units that some user has imported (dev-route units nobody imported are left alone). */
  listPendingUnitIds(limit: number): Promise<string[]>;
  /**
   * Ready imported units, each with an importer who can't see a digest of it yet (none exists, or every one also
   * uses videos that person didn't import), after fewer than MAX_DIGEST_ATTEMPTS failed digests.
   */
  listUnitsNeedingDigest(limit: number): Promise<{ unitId: string; userId: string | null }[]>;
  /** The user behind each unit's newest import, so the sweep never digests different people's videos together. */
  newestImporters(unitIds: string[]): Promise<Map<string, string>>;
  /** Of these ready units, the ones with no non-failed artifact and no exclusion yet. Digests are shared by everyone. */
  unitsNeedingDigest(unitIds: string[]): Promise<string[]>;
  /** Returns the id of the digestion_prompts revision for this exact text + few-shot set, creating the next revision if new. */
  registerPrompt(promptText: string, fewShot: unknown[]): Promise<string>;
  saveArtifacts(artifacts: DigestArtifact[], exclusions: Exclusion[], promptId: string | null): Promise<StoredArtifact[]>;
  /** Records a digestion failure per unit as a failed artifact, so the unit shows the error instead of waiting forever. */
  saveFailedArtifacts(unitIds: string[], error: string, promptId: string | null): Promise<void>;
}

export class MemoryStore implements Store {
  units = new Map<string, IngestedUnit>();
  artifacts: StoredArtifact[] = [];
  exclusions: (Exclusion & { promptId: string | null })[] = [];
  prompts: { id: string; revision: number; promptText: string; fewShot: unknown[] }[] = [];
  /** Test/dev stand-in for user_imports: units some user has imported. */
  imported = new Set<string>();

  async saveUnit(unit: IngestedUnit) { this.units.set(unit.id, unit); }
  async getUnits(ids: string[]) { return ids.map((id) => this.units.get(id)).filter((u): u is IngestedUnit => !!u); }
  async listReadyUnits() { return [...this.units.values()].filter((u) => u.status === "ready"); }
  async claimPendingUnits(ids?: string[], limit = 50) {
    const claimed: IngestedUnit[] = [];
    for (const u of this.units.values()) {
      if (claimed.length >= limit) break;
      if (u.status !== "pending" || (ids && !ids.includes(u.id))) continue;
      const running = { ...u, status: "running" as const };
      this.units.set(u.id, running);
      claimed.push(running);
    }
    return claimed;
  }
  async listPendingUnitIds(limit: number) {
    return [...this.units.values()].filter((u) => u.status === "pending" && this.imported.has(u.id)).slice(0, limit).map((u) => u.id);
  }
  async listUnitsNeedingDigest(limit: number) {
    const ids = [...this.units.values()].filter((u) => this.imported.has(u.id)).map((u) => u.id);
    const failures = (id: string) => this.artifacts.filter((a) => a.source_ids.includes(id) && a.ingestion_status === "failed").length;
    return (await this.unitsNeedingDigest(ids)).filter((id) => failures(id) < MAX_DIGEST_ATTEMPTS).slice(0, limit)
      .map((unitId) => ({ unitId, userId: null }));
  }
  async newestImporters() { return new Map<string, string>(); }
  async unitsNeedingDigest(unitIds: string[]) {
    return unitIds.filter((id) => this.units.get(id)?.status === "ready"
      && !this.artifacts.some((a) => a.source_ids.includes(id) && a.ingestion_status !== "failed")
      && !this.exclusions.some((e) => e.unit_id === id));
  }
  async registerPrompt(promptText: string, fewShot: unknown[]) {
    const found = this.prompts.find((p) => p.promptText === promptText && JSON.stringify(p.fewShot) === JSON.stringify(fewShot));
    if (found) return found.id;
    const p = { id: randomUUID(), revision: this.prompts.length + 1, promptText, fewShot };
    this.prompts.push(p);
    return p.id;
  }
  private sourcesFor(ids: string[]) {
    const src = ids.map((id) => this.units.get(id)).filter((u): u is IngestedUnit => !!u);
    return { src, sources: src.map((u) => ({ url: u.sourceUrl, title: u.title, content_type: u.contentType ?? "youtube_video", retrieved_at: u.extractedAt })) };
  }
  async saveArtifacts(artifacts: DigestArtifact[], exclusions: Exclusion[], promptId: string | null) {
    const stored = artifacts.map((a): StoredArtifact => {
      const { src, sources } = this.sourcesFor(a.source_ids);
      return {
        ...a, id: randomUUID(), version: 1, source_url: src[0]?.sourceUrl ?? "", sources,
        ingestion_status: "ready", review_status: "pending", digestion_prompt_id: promptId,
        project_context_id: null, project_context_version: null, error: null,
      };
    });
    this.artifacts.push(...stored);
    for (const e of exclusions) this.exclusions.push({ ...e, promptId });
    return stored;
  }
  async saveFailedArtifacts(unitIds: string[], error: string, promptId: string | null) {
    for (const id of unitIds) {
      const { src, sources } = this.sourcesFor([id]);
      this.artifacts.push({
        name: "Digestion failed", source_ids: [id], category: "", processed_text: "", evidence: [], selection_reason: "",
        id: randomUUID(), version: 1, source_url: src[0]?.sourceUrl ?? "", sources,
        ingestion_status: "failed", review_status: "pending", digestion_prompt_id: promptId,
        project_context_id: null, project_context_version: null, error,
      } as unknown as StoredArtifact);
    }
  }
}

function rowToUnit(r: any): IngestedUnit {
  return {
    id: r.id, submittedUrl: r.submitted_url, sourceUrl: r.source_url, startSeconds: r.start_seconds, title: r.title, contentType: r.content_type,
    transcript: r.transcript, extractionMethod: r.extraction_method, extractedAt: r.extracted_at, status: r.status, error: r.error,
  };
}

const ARTIFACT_RETURNING = "id, version, source_url, sources, ingestion_status, review_status, digestion_prompt_id, project_context_id, project_context_version, error";

// Needs claimed_at from db/migrations/005_outputs.sql. A unit claimed longer ago than STALE_CLAIM_MINUTES belongs to
// a processor that died mid-extraction, so it's claimable again.
const CLAIMABLE = `(status = 'pending' OR (status = 'running' AND (claimed_at IS NULL OR claimed_at < now() - interval '${STALE_CLAIM_MINUTES} minutes')))`;

// A user sees an artifact only when they imported every video it was built from (web/src/feed.js and skills.js),
// so a digest never shows one person's videos to another. This is "no visible digest of u for that user".
const UNSEEN_BY = (user: string) => `NOT EXISTS (
  SELECT 1 FROM artifacts a WHERE u.id = ANY (a.source_ids) AND a.ingestion_status <> 'failed'
    AND a.source_ids <@ ARRAY(SELECT x.unit_id FROM user_imports x WHERE x.user_id = ${user}))`;

/** Writes to the shared TigerData schema (db/migrations). Workflow 1 owns these tables only. */
export class PgStore implements Store {
  private pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }

  async saveUnit(u: IngestedUnit) {
    await this.pool.query(
      `INSERT INTO ingested_units (id, submitted_url, source_url, start_seconds, title, transcript, extraction_method, extracted_at, status, error, content_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET title=$5, transcript=$6, extraction_method=$7, extracted_at=$8, status=$9, error=$10`,
      [u.id, u.submittedUrl, u.sourceUrl, u.startSeconds, u.title, u.transcript && JSON.stringify(u.transcript), u.extractionMethod, u.extractedAt, u.status, u.error, u.contentType ?? "youtube_video"],
    );
  }

  async getUnits(ids: string[]) {
    const { rows } = await this.pool.query(`SELECT * FROM ingested_units WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [ids]);
    return rows.map(rowToUnit);
  }

  async listReadyUnits() {
    const { rows } = await this.pool.query(`SELECT * FROM ingested_units WHERE status='ready' ORDER BY created_at`);
    return rows.map(rowToUnit);
  }

  async claimPendingUnits(ids?: string[], limit = 50) {
    const { rows } = await this.pool.query(
      `UPDATE ingested_units SET status = 'running', claimed_at = now()
       WHERE id IN (SELECT id FROM ingested_units WHERE ${CLAIMABLE} AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
                    ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
       RETURNING *`, [ids ?? null, limit]);
    return rows.map(rowToUnit);
  }

  async listPendingUnitIds(limit: number) {
    const { rows } = await this.pool.query(
      `SELECT u.id FROM ingested_units u WHERE ${CLAIMABLE} AND EXISTS (SELECT 1 FROM user_imports ui WHERE ui.unit_id = u.id)
       ORDER BY u.created_at LIMIT $1`, [limit]);
    return rows.map((r) => r.id as string);
  }

  async listUnitsNeedingDigest(limit: number) {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (u.id) u.id, ui.user_id FROM ingested_units u JOIN user_imports ui ON ui.unit_id = u.id
       WHERE u.status = 'ready' AND ${UNSEEN_BY("ui.user_id")}
         AND NOT EXISTS (SELECT 1 FROM artifact_exclusions e WHERE e.unit_id = u.id)
         AND (SELECT count(*) FROM artifacts a WHERE u.id = ANY (a.source_ids) AND a.ingestion_status = 'failed') < $2
       ORDER BY u.id, ui.created_at DESC LIMIT $1`, [limit, MAX_DIGEST_ATTEMPTS]);
    return rows.map((r) => ({ unitId: r.id as string, userId: r.user_id as string }));
  }

  async newestImporters(unitIds: string[]) {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (unit_id) unit_id, user_id FROM user_imports WHERE unit_id = ANY($1::uuid[]) ORDER BY unit_id, created_at DESC`, [unitIds]);
    return new Map(rows.map((r) => [r.unit_id as string, r.user_id as string]));
  }

  // A unit needs a digest while someone who imported it can't see one; with no importer (CLI), while none exists.
  async unitsNeedingDigest(unitIds: string[]) {
    const { rows } = await this.pool.query(
      `SELECT u.id FROM ingested_units u
       WHERE u.id = ANY($1::uuid[]) AND u.status = 'ready'
         AND NOT EXISTS (SELECT 1 FROM artifact_exclusions e WHERE e.unit_id = u.id)
         AND (EXISTS (SELECT 1 FROM user_imports ui WHERE ui.unit_id = u.id AND ${UNSEEN_BY("ui.user_id")})
              OR (NOT EXISTS (SELECT 1 FROM user_imports ui WHERE ui.unit_id = u.id)
                  AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE u.id = ANY (a.source_ids) AND a.ingestion_status <> 'failed')))`,
      [unitIds]);
    return rows.map((r) => r.id as string);
  }

  async registerPrompt(promptText: string, fewShot: unknown[]) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('digestion_prompts'))"); // serialize revision numbering
      const found = await client.query(
        `SELECT id FROM digestion_prompts WHERE name = 'Digestion Prompt' AND prompt_text = $1 AND few_shot = $2::jsonb LIMIT 1`,
        [promptText, JSON.stringify(fewShot)]);
      let id: string;
      if (found.rows[0]) id = found.rows[0].id;
      else {
        const ins = await client.query(
          `INSERT INTO digestion_prompts (revision, prompt_text, few_shot)
           VALUES ((SELECT coalesce(max(revision), 0) + 1 FROM digestion_prompts WHERE name = 'Digestion Prompt'), $1, $2::jsonb) RETURNING id`,
          [promptText, JSON.stringify(fewShot)]);
        id = ins.rows[0].id;
      }
      await client.query("COMMIT");
      return id;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async saveArtifacts(artifacts: DigestArtifact[], exclusions: Exclusion[], promptId: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const stored: StoredArtifact[] = [];
      for (const a of artifacts) {
        const { rows: src } = await client.query(
          `SELECT id, source_url, title, content_type, extracted_at FROM ingested_units WHERE id = ANY($1::uuid[])`, [a.source_ids]);
        const sources = src.map((s) => ({ url: s.source_url, title: s.title, content_type: s.content_type, retrieved_at: s.extracted_at }));
        const { rows } = await client.query(
          `INSERT INTO artifacts (name, source_url, source_ids, sources, processed_text, category, selection_reason, evidence, digestion_prompt_id,
                                  ingestion_status, processed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',now()) RETURNING ${ARTIFACT_RETURNING}`,
          [a.name, src[0]?.source_url ?? "", a.source_ids, JSON.stringify(sources), a.processed_text, a.category, a.selection_reason, JSON.stringify(a.evidence),
           promptId]);
        stored.push({ ...a, ...rows[0] });
      }
      if (promptId) for (const e of exclusions) {
        await client.query(`INSERT INTO artifact_exclusions (unit_id, digestion_prompt_id, reason) VALUES ($1,$2,$3)`, [e.unit_id, promptId, e.reason]);
      }
      await client.query("COMMIT");
      return stored;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async saveFailedArtifacts(unitIds: string[], error: string, promptId: string | null) {
    for (const id of unitIds) {
      const { rows: src } = await this.pool.query(`SELECT id, source_url, title, content_type, extracted_at FROM ingested_units WHERE id = $1`, [id]);
      if (!src[0]) continue;
      const sources = [{ url: src[0].source_url, title: src[0].title, content_type: src[0].content_type, retrieved_at: src[0].extracted_at }];
      await this.pool.query(
        `INSERT INTO artifacts (name, source_url, source_ids, sources, digestion_prompt_id, ingestion_status, error, processed_at)
         VALUES ('Digestion failed', $1, $2, $3, $4, 'failed', $5, now())`,
        [src[0].source_url, [id], JSON.stringify(sources), promptId, error]);
    }
  }
}
