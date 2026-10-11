import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { DigestArtifact, IngestedUnit, StoredArtifact } from "./types.ts";

type Exclusion = { unit_id: string; reason: string };

export interface Store {
  saveUnit(unit: IngestedUnit): Promise<void>;
  listReadyUnits(): Promise<IngestedUnit[]>;
  /** Returns the id of the digestion_prompts revision for this exact text + few-shot set, creating the next revision if new. */
  registerPrompt(promptText: string, fewShot: unknown[]): Promise<string>;
  saveArtifacts(artifacts: DigestArtifact[], exclusions: Exclusion[], promptId: string | null): Promise<StoredArtifact[]>;
}

export class MemoryStore implements Store {
  units = new Map<string, IngestedUnit>();
  artifacts: StoredArtifact[] = [];
  exclusions: (Exclusion & { promptId: string | null })[] = [];
  prompts: { id: string; revision: number; promptText: string; fewShot: unknown[] }[] = [];
  async saveUnit(unit: IngestedUnit) { this.units.set(unit.id, unit); }
  async registerPrompt(promptText: string, fewShot: unknown[]) {
    const found = this.prompts.find((p) => p.promptText === promptText && JSON.stringify(p.fewShot) === JSON.stringify(fewShot));
    if (found) return found.id;
    const p = { id: randomUUID(), revision: this.prompts.length + 1, promptText, fewShot };
    this.prompts.push(p);
    return p.id;
  }
  async listReadyUnits() { return [...this.units.values()].filter((u) => u.status === "ready"); }
  async saveArtifacts(artifacts: DigestArtifact[], exclusions: Exclusion[], promptId: string | null) {
    const stored = artifacts.map((a): StoredArtifact => {
      const src = a.source_ids.map((id) => this.units.get(id)).filter((u): u is IngestedUnit => !!u);
      return {
        ...a, id: randomUUID(), version: 1, source_url: src[0]?.sourceUrl ?? "",
        sources: src.map((u) => ({ url: u.sourceUrl, title: u.title, content_type: "youtube_video", retrieved_at: u.extractedAt })),
        ingestion_status: "ready", review_status: "pending", digestion_prompt_id: promptId,
      };
    });
    this.artifacts.push(...stored);
    for (const e of exclusions) this.exclusions.push({ ...e, promptId });
    return stored;
  }
}

/** Writes to the shared TigerData schema (db/migrations/001_shared_schema.sql). Workflow 1 owns these tables only. */
export class PgStore implements Store {
  private pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }

  async saveUnit(u: IngestedUnit) {
    await this.pool.query(
      `INSERT INTO ingested_units (id, submitted_url, source_url, start_seconds, title, transcript, extraction_method, extracted_at, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET title=$5, transcript=$6, extraction_method=$7, extracted_at=$8, status=$9, error=$10`,
      [u.id, u.submittedUrl, u.sourceUrl, u.startSeconds, u.title, u.transcript && JSON.stringify(u.transcript), u.extractionMethod, u.extractedAt, u.status, u.error],
    );
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

  async listReadyUnits() {
    const { rows } = await this.pool.query(`SELECT * FROM ingested_units WHERE status='ready' ORDER BY created_at`);
    return rows.map((r): IngestedUnit => ({
      id: r.id, submittedUrl: r.submitted_url, sourceUrl: r.source_url, startSeconds: r.start_seconds, title: r.title,
      transcript: r.transcript, extractionMethod: r.extraction_method, extractedAt: r.extracted_at, status: r.status, error: r.error,
    }));
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
          `INSERT INTO artifacts (name, source_url, source_ids, sources, processed_text, category, selection_reason, evidence, digestion_prompt_id, ingestion_status, processed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',now()) RETURNING id, version, source_url, sources, ingestion_status, review_status, digestion_prompt_id`,
          [a.name, src[0]?.source_url ?? "", a.source_ids, JSON.stringify(sources), a.processed_text, a.category, a.selection_reason, JSON.stringify(a.evidence), promptId]);
        const r = rows[0];
        stored.push({ ...a, id: r.id, version: r.version, source_url: r.source_url, sources: r.sources, ingestion_status: r.ingestion_status, review_status: r.review_status, digestion_prompt_id: r.digestion_prompt_id });
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
}
