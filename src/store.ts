import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { DigestArtifact, IngestedUnit } from "./types.ts";

export interface Store {
  saveUnit(unit: IngestedUnit): Promise<void>;
  listReadyUnits(): Promise<IngestedUnit[]>;
  saveArtifacts(artifacts: DigestArtifact[], exclusions: { source_id: string; reason: string }[], promptId: string | null): Promise<string[]>;
}

export class MemoryStore implements Store {
  units = new Map<string, IngestedUnit>();
  artifacts: (DigestArtifact & { id: string; promptId: string | null })[] = [];
  exclusions: { source_id: string; reason: string; promptId: string | null }[] = [];
  async saveUnit(unit: IngestedUnit) { this.units.set(unit.id, unit); }
  async listReadyUnits() { return [...this.units.values()].filter((u) => u.status === "ready"); }
  async saveArtifacts(artifacts: DigestArtifact[], exclusions: { source_id: string; reason: string }[], promptId: string | null) {
    const ids = artifacts.map((a) => { const id = randomUUID(); this.artifacts.push({ ...a, id, promptId }); return id; });
    for (const e of exclusions) this.exclusions.push({ ...e, promptId });
    return ids;
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

  async listReadyUnits() {
    const { rows } = await this.pool.query(`SELECT * FROM ingested_units WHERE status='ready' ORDER BY created_at`);
    return rows.map((r): IngestedUnit => ({
      id: r.id, submittedUrl: r.submitted_url, sourceUrl: r.source_url, startSeconds: r.start_seconds, title: r.title,
      transcript: r.transcript, extractionMethod: r.extraction_method, extractedAt: r.extracted_at, status: r.status, error: r.error,
    }));
  }

  async saveArtifacts(artifacts: DigestArtifact[], exclusions: { source_id: string; reason: string }[], promptId: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ids: string[] = [];
      for (const a of artifacts) {
        const { rows: src } = await client.query(
          `SELECT id, source_url, title, content_type, extracted_at FROM ingested_units WHERE id = ANY($1::uuid[])`, [a.source_ids]);
        const sources = src.map((s) => ({ url: s.source_url, title: s.title, content_type: s.content_type, retrieved_at: s.extracted_at }));
        const { rows } = await client.query(
          `INSERT INTO artifacts (name, source_url, source_ids, sources, processed_text, category, selection_reason, evidence, digestion_prompt_id, ingestion_status, processed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',now()) RETURNING id`,
          [a.name, src[0]?.source_url ?? "", a.source_ids, JSON.stringify(sources), a.processed_text, a.category, a.selection_reason, JSON.stringify(a.evidence), promptId]);
        ids.push(rows[0].id);
      }
      if (promptId) for (const e of exclusions) {
        await client.query(`INSERT INTO artifact_exclusions (unit_id, digestion_prompt_id, reason) VALUES ($1,$2,$3)`, [e.source_id, promptId, e.reason]);
      }
      await client.query("COMMIT");
      return ids;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
