import { randomUUID } from "node:crypto";
import type { Database, Statement } from "../db.js";
import type { DigestArtifact, IngestedUnit, StoredArtifact } from "./types.js";
import { remaining, resumesAt, type Limits } from "./limits.js";
import { available, deferredUntil, limitParams, NOW, USED_DAY, USED_MONTH } from "./ledger.js";

export interface Claimed { claimed: IngestedUnit[]; deferred: string[]; resumesAt: Date | null }
export interface Reserved { allowed: string[]; deferred: string[]; resumesAt: Date | null }
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
  /**
   * claimPendingUnits within the processing limits: claims at most what today's and this month's limits leave, and
   * when the limit runs out, marks the requested pending units it couldn't claim as deferred until room opens up.
   */
  claimWithinLimits(ids: string[], limits: Limits): Promise<Claimed>;
  /**
   * Of these ready units about to be digested, the ones the limits allow. The first digest after a unit's
   * extraction is covered by the extraction's charge; any other digest (a shared video digested for someone else,
   * a retry) takes a slot. Units without room are marked deferred until it opens up.
   */
  reserveDigests(ids: string[], limits: Limits): Promise<Reserved>;
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
  /** The processing_starts ledger the limits count, and when deferred units may start. */
  starts: { unitId: string; kind: "extract" | "digest"; charged: boolean; at: Date }[] = [];
  deferredUntil = new Map<string, Date>();
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
  private used(now: Date) {
    const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const charged = this.starts.filter((e) => e.charged).map((e) => e.at.getTime());
    return { today: charged.filter((t) => t >= day).length, month: charged.filter((t) => t >= month).length };
  }
  async claimWithinLimits(ids: string[], limits: Limits): Promise<Claimed> {
    const now = new Date();
    const used = this.used(now);
    const room = remaining(limits, used);
    const claimed = room > 0 ? await this.claimPendingUnits(ids, Math.min(50, room)) : [];
    for (const u of claimed) { this.starts.push({ unitId: u.id, kind: "extract", charged: true, at: now }); this.deferredUntil.delete(u.id); }
    if (claimed.length < room) return { claimed, deferred: [], resumesAt: null };
    const until = resumesAt(limits, { today: used.today + claimed.length, month: used.month + claimed.length }, now);
    const deferred = ids.filter((id) => this.units.get(id)?.status === "pending");
    deferred.forEach((id) => this.deferredUntil.set(id, until));
    return { claimed, deferred, resumesAt: deferred.length ? until : null };
  }
  async reserveDigests(ids: string[], limits: Limits): Promise<Reserved> {
    const now = new Date();
    const used = this.used(now);
    const last = (id: string) => this.starts.filter((e) => e.unitId === id).at(-1);
    const covered = ids.filter((id) => last(id)?.kind === "extract");
    const charged = ids.filter((id) => last(id)?.kind !== "extract");
    const room = remaining(limits, used);
    const allowedCharged = charged.slice(0, room === Infinity ? charged.length : room);
    const deferred = charged.slice(allowedCharged.length);
    for (const id of covered) this.starts.push({ unitId: id, kind: "digest", charged: false, at: now });
    for (const id of allowedCharged) this.starts.push({ unitId: id, kind: "digest", charged: true, at: now });
    const allowed = [...covered, ...allowedCharged];
    allowed.forEach((id) => this.deferredUntil.delete(id));
    const until = deferred.length ? resumesAt(limits, { today: used.today + allowedCharged.length, month: used.month + allowedCharged.length }, now) : null;
    if (until) deferred.forEach((id) => this.deferredUntil.set(id, until));
    return { allowed: ids.filter((id) => allowed.includes(id)), deferred, resumesAt: until };
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
    transcript: r.transcript, extractionMethod: r.extraction_method, extractedAt: r.extracted_at ? new Date(r.extracted_at) : null, status: r.status, error: r.error,
  };
}

const CLAIMABLE = `(status = 'pending' OR (status = 'running' AND (claimed_at IS NULL OR julianday(claimed_at) < julianday('now', '-${STALE_CLAIM_MINUTES} minutes'))))`;
const UNSEEN_BY = (user: string) => `NOT EXISTS (
  SELECT 1 FROM artifacts a WHERE EXISTS (SELECT 1 FROM json_each(a.source_ids) WHERE value = u.id)
    AND a.ingestion_status <> 'failed'
    AND NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) src WHERE NOT EXISTS
      (SELECT 1 FROM user_imports x WHERE x.unit_id = src.value AND x.user_id = ${user})))`;

export class D1Store implements Store {
  constructor(private db: Database) {}
  async saveUnit(u: IngestedUnit) {
    await this.db.query(`INSERT INTO ingested_units
      (id,submitted_url,source_url,start_seconds,title,transcript,extraction_method,extracted_at,status,error,content_type)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,transcript=excluded.transcript,
      extraction_method=excluded.extraction_method,extracted_at=excluded.extracted_at,status=excluded.status,error=excluded.error`,
      [u.id,u.submittedUrl,u.sourceUrl,u.startSeconds,u.title,u.transcript && JSON.stringify(u.transcript),u.extractionMethod,u.extractedAt?.toISOString() ?? null,u.status,u.error,u.contentType ?? 'youtube_video']);
  }
  async getUnits(ids: string[]) {
    const { rows } = await this.db.query(`SELECT * FROM ingested_units WHERE id IN (SELECT value FROM json_each(?1)) ORDER BY created_at`, [JSON.stringify(ids)]);
    return rows.map(rowToUnit);
  }
  async listReadyUnits() {
    return (await this.db.query(`SELECT * FROM ingested_units WHERE status='ready' ORDER BY created_at`)).rows.map(rowToUnit);
  }
  async claimPendingUnits(ids?: string[], limit = 50) {
    const { rows } = await this.db.query(`UPDATE ingested_units SET status='running',claimed_at=${NOW}
      WHERE id IN (SELECT id FROM ingested_units WHERE ${CLAIMABLE}
        AND (?1 IS NULL OR id IN (SELECT value FROM json_each(?1))) ORDER BY created_at LIMIT ?2) RETURNING *`,
      [ids ? JSON.stringify(ids) : null,limit]);
    return rows.map(rowToUnit);
  }
  async claimWithinLimits(ids: string[], limits: Limits): Promise<Claimed> {
    const token = randomUUID();
    const params = [...limitParams(limits), JSON.stringify(ids), token];
    const results = await this.db.batch([
      { sql: `INSERT INTO processing_starts(unit_id,kind,charged,batch_token)
        SELECT id,'extract',1,?4 FROM ingested_units WHERE ${CLAIMABLE} AND id IN (SELECT value FROM json_each(?3))
        ORDER BY created_at LIMIT max(0,min(50,?1 - ${USED_DAY},?2 - ${USED_MONTH}))`, params },
      { sql: `UPDATE ingested_units SET status='running',claimed_at=${NOW},deferred_until=NULL
        WHERE id IN (SELECT unit_id FROM processing_starts WHERE batch_token=?1) RETURNING *`, params: [token] },
      { sql: `UPDATE ingested_units SET deferred_until=${deferredUntil()}
        WHERE status='pending' AND id IN (SELECT value FROM json_each(?3)) AND NOT ${available()} RETURNING id,deferred_until`, params: params.slice(0,3) },
    ]);
    const deferred = results[2].rows;
    return { claimed: results[1].rows.map(rowToUnit), deferred: deferred.map((r) => r.id), resumesAt: deferred.length ? new Date(deferred[0].deferred_until) : null };
  }
  async reserveDigests(ids: string[], limits: Limits): Promise<Reserved> {
    if (!ids.length) return { allowed: [],deferred: [],resumesAt: null };
    const token = randomUUID();
    const statements: Statement[] = [...new Set(ids)].map((id) => {
      const covered = `(SELECT kind FROM processing_starts WHERE unit_id=?3 ORDER BY created_at DESC,id DESC LIMIT 1) IS 'extract'`;
      return { sql: `INSERT INTO processing_starts(unit_id,kind,charged,batch_token)
        SELECT ?3,'digest',CASE WHEN ${covered} THEN 0 ELSE 1 END,?4 WHERE ${covered} OR ${available()}`,
        params: [...limitParams(limits),id,token] };
    });
    const result = await this.db.batch([...statements,
      { sql: `UPDATE ingested_units SET deferred_until=NULL WHERE id IN (SELECT unit_id FROM processing_starts WHERE batch_token=?1)`, params: [token] },
      { sql: `UPDATE ingested_units SET deferred_until=${deferredUntil()}
        WHERE id IN (SELECT value FROM json_each(?3)) AND id NOT IN (SELECT unit_id FROM processing_starts WHERE batch_token=?4)
        RETURNING id,deferred_until`, params: [...limitParams(limits),JSON.stringify(ids),token] },
      { sql: `SELECT unit_id FROM processing_starts WHERE batch_token=?1`, params: [token] },
    ]);
    const allowed = new Set(result.at(-1)!.rows.map((r) => r.unit_id));
    const deferred = result.at(-2)!.rows;
    return { allowed: ids.filter((id) => allowed.has(id)),deferred: ids.filter((id) => !allowed.has(id)),resumesAt: deferred.length ? new Date(deferred[0].deferred_until) : null };
  }
  async listPendingUnitIds(limit: number) {
    const { rows } = await this.db.query(`SELECT u.id FROM ingested_units u WHERE ${CLAIMABLE}
      AND EXISTS(SELECT 1 FROM user_imports ui WHERE ui.unit_id=u.id) ORDER BY u.created_at LIMIT ?1`, [limit]);
    return rows.map((r) => r.id as string);
  }
  async listUnitsNeedingDigest(limit: number) {
    const { rows } = await this.db.query(`SELECT id,user_id FROM (
      SELECT u.id,ui.user_id,row_number() OVER(PARTITION BY u.id ORDER BY ui.created_at DESC,ui.user_id) AS n
      FROM ingested_units u JOIN user_imports ui ON ui.unit_id=u.id
      WHERE u.status='ready' AND ${UNSEEN_BY('ui.user_id')}
      AND NOT EXISTS(SELECT 1 FROM artifact_exclusions e WHERE e.unit_id=u.id)
      AND (SELECT count(*) FROM artifacts a WHERE EXISTS(SELECT 1 FROM json_each(a.source_ids) WHERE value=u.id)
        AND a.ingestion_status='failed') < ?2) WHERE n=1 ORDER BY id LIMIT ?1`, [limit,MAX_DIGEST_ATTEMPTS]);
    return rows.map((r) => ({ unitId: r.id as string,userId: r.user_id as string }));
  }
  async newestImporters(ids: string[]) {
    const { rows } = await this.db.query(`SELECT unit_id,user_id FROM (
      SELECT unit_id,user_id,row_number() OVER(PARTITION BY unit_id ORDER BY created_at DESC,user_id) AS n
      FROM user_imports WHERE unit_id IN (SELECT value FROM json_each(?1))) WHERE n=1`, [JSON.stringify(ids)]);
    return new Map(rows.map((r) => [r.unit_id as string,r.user_id as string]));
  }
  async unitsNeedingDigest(ids: string[]) {
    const { rows } = await this.db.query(`SELECT u.id FROM ingested_units u
      WHERE u.id IN (SELECT value FROM json_each(?1)) AND u.status='ready'
      AND NOT EXISTS(SELECT 1 FROM artifact_exclusions e WHERE e.unit_id=u.id)
      AND (EXISTS(SELECT 1 FROM user_imports ui WHERE ui.unit_id=u.id AND ${UNSEEN_BY('ui.user_id')})
        OR (NOT EXISTS(SELECT 1 FROM user_imports ui WHERE ui.unit_id=u.id)
          AND NOT EXISTS(SELECT 1 FROM artifacts a WHERE EXISTS(SELECT 1 FROM json_each(a.source_ids) WHERE value=u.id)
            AND a.ingestion_status<>'failed')))`, [JSON.stringify(ids)]);
    return rows.map((r) => r.id as string);
  }
  async registerPrompt(promptText: string, fewShot: unknown[]) {
    const params = [promptText,JSON.stringify(fewShot)];
    const results = await this.db.batch([
      { sql: `INSERT INTO digestion_prompts(revision,prompt_text,few_shot)
        SELECT (SELECT coalesce(max(revision),0)+1 FROM digestion_prompts WHERE name='Digestion Prompt'),?1,?2
        WHERE NOT EXISTS(SELECT 1 FROM digestion_prompts WHERE name='Digestion Prompt' AND prompt_text=?1 AND few_shot=?2)`, params },
      { sql: `SELECT id FROM digestion_prompts WHERE name='Digestion Prompt' AND prompt_text=?1 AND few_shot=?2 LIMIT 1`, params },
    ]);
    return results[1].rows[0].id as string;
  }
  async saveArtifacts(artifacts: DigestArtifact[], exclusions: Exclusion[], promptId: string | null) {
    const units = await this.getUnits([...new Set(artifacts.flatMap((a) => a.source_ids))]);
    const statements: Statement[] = artifacts.map((a) => {
      const src = a.source_ids.map((id) => units.find((u) => u.id===id)).filter((u): u is IngestedUnit => !!u);
      const sources = src.map((u) => ({ url: u.sourceUrl,title: u.title,content_type: u.contentType,retrieved_at: u.extractedAt }));
      return { sql: `INSERT INTO artifacts(name,source_url,source_ids,sources,processed_text,category,selection_reason,evidence,
        digestion_prompt_id,ingestion_status,processed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'ready',${NOW}) RETURNING *`,
        params: [a.name,src[0]?.sourceUrl ?? '',JSON.stringify(a.source_ids),JSON.stringify(sources),a.processed_text,a.category,a.selection_reason,JSON.stringify(a.evidence),promptId] };
    });
    if (promptId) for (const e of exclusions) statements.push({ sql: `INSERT INTO artifact_exclusions(unit_id,digestion_prompt_id,reason) VALUES(?1,?2,?3)`, params: [e.unit_id,promptId,e.reason] });
    const results = await this.db.batch(statements);
    return artifacts.map((a,i) => ({ ...a,...results[i].rows[0] })) as StoredArtifact[];
  }
  async saveFailedArtifacts(ids: string[], error: string, promptId: string | null) {
    const statements: Statement[] = (await this.getUnits(ids)).map((u) => ({
      sql: `INSERT INTO artifacts(name,source_url,source_ids,sources,digestion_prompt_id,ingestion_status,error,processed_at)
        VALUES('Digestion failed',?1,?2,?3,?4,'failed',?5,${NOW})`,
      params: [u.sourceUrl,JSON.stringify([u.id]),JSON.stringify([{ url:u.sourceUrl,title:u.title,content_type:u.contentType,retrieved_at:u.extractedAt }]),promptId,error],
    }));
    await this.db.batch(statements);
  }
}
