// agent_briefs (db/migrations/005_agent_briefs.sql): the web Worker creates a pending row for the skills a user picked,
// the processor claims it, writes the refined brief and every agent's prompt, or the actual error.

import { randomUUID } from "node:crypto";
import type { Database } from "../db.js";
import { NOW } from "../ingest/ledger.js";
import type { HandoffBrief, HandoffSkill } from "./handoff.js";
import type { ActionItem } from "./types.js";

/** A claimed `running` brief older than this belongs to a processor that died. It outlasts two 10-minute model calls. */
export const STALE_BRIEF_MINUTES = 25;

export interface BriefClaim { id: string; token: string; skill_result_ids: string[] }

export interface HandoffStore {
  /** Takes a pending (or stale) brief as `running`; null when it's taken or settled. Returns its skill ids and claim token. */
  claim(briefId: string): Promise<BriefClaim | null>;
  /** The ready skills among these ids, with what they were made from, in the given order. */
  loadSkills(ids: string[]): Promise<HandoffSkill[]>;
  /** Both settle the brief only while this claim still holds it; false when a newer worker took it over. */
  finish(c: BriefClaim, brief: HandoffBrief, prompts: unknown, revision: string): Promise<boolean>;
  fail(c: BriefClaim, error: string): Promise<boolean>;
}

/** name and description from SKILL.md frontmatter (skills.ts writes description as a JSON string). */
export function frontmatter(md: string): { name: string | null; description: string | null } {
  const head = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? "";
  const field = (k: string) => {
    const v = new RegExp(`^${k}:\\s*(.+)$`, "m").exec(head)?.[1]?.trim();
    if (!v) return null;
    try { return v.startsWith('"') ? String(JSON.parse(v)) : v; } catch { return v; }
  };
  return { name: field("name"), description: field("description") };
}

/**
 * Two selected skills can share a name; the second one installed must not overwrite the first. Every original name
 * is reserved first, so a suffix never lands on another skill's real name (eval, eval, eval-2 -> eval, eval-3, eval-2).
 */
export function uniqueSlugs<T extends { slug: string }>(skills: T[]): T[] {
  const used = new Set(skills.map((s) => s.slug));
  const kept = new Set<string>();
  return skills.map((s) => {
    if (!kept.has(s.slug)) { kept.add(s.slug); return s; }
    let n = 2;
    while (used.has(`${s.slug}-${n}`)) n++;
    const slug = `${s.slug}-${n}`;
    used.add(slug);
    return { ...s, slug };
  });
}

export function rowToSkill(r: any): HandoffSkill {
  const fm = frontmatter(r.skill_markdown);
  const titles: Record<string, string | null> = r.unit_titles ?? {};
  const urls: Record<string, string> = r.unit_urls ?? {};
  return {
    id: r.id,
    slug: fm.name ?? r.id,
    description: fm.description ?? r.artifact_name,
    skill_markdown: r.skill_markdown,
    artifact_name: r.artifact_name,
    category: r.category,
    sources: (r.sources ?? []).map((s: any) => ({ url: s.url, title: s.title ?? null })),
    evidence: (r.evidence ?? []).map((e: any) => ({
      source_title: titles[e.source_id] ?? urls[e.source_id] ?? "source", start_seconds: e.start_seconds, end_seconds: e.end_seconds, passage: e.passage,
    })),
    action_items: (r.action_items ?? []) as ActionItem[],
  };
}

export class D1HandoffStore implements HandoffStore {
  constructor(private db: Database) {}
  async claim(id: string) {
    const { rows } = await this.db.query(`UPDATE agent_briefs SET status='running',error=NULL,updated_at=${NOW},claim_token=?2
      WHERE id=?1 AND (status='pending' OR (status='running' AND julianday(updated_at)<julianday('now','-${STALE_BRIEF_MINUTES} minutes')))
      RETURNING claim_token,skill_result_ids`,[id,randomUUID()]);
    return rows[0] ? { id,token: rows[0].claim_token as string,skill_result_ids: rows[0].skill_result_ids as string[] } : null;
  }
  async loadSkills(ids: string[]) {
    const { rows } = await this.db.query(`SELECT s.id,s.skill_markdown,a.name AS artifact_name,a.category,a.sources,a.evidence,
      (SELECT json_group_object(u.id,u.title) FROM ingested_units u WHERE u.id IN (SELECT value FROM json_each(a.source_ids))) AS unit_titles,
      (SELECT json_group_object(u.id,u.source_url) FROM ingested_units u WHERE u.id IN (SELECT value FROM json_each(a.source_ids))) AS unit_urls,
      (SELECT json_group_array(json(item)) FROM (
        SELECT json_object('task',i.task,'applicability_evidence',json(i.applicability_evidence),'prerequisites',json(i.prerequisites),
          'steps',json(i.steps),'source_refs',json(i.source_refs),'completion_check',i.completion_check) AS item
        FROM action_items i WHERE i.skill_result_id=s.id ORDER BY i.position)) AS action_items
      FROM json_each(?1) picked JOIN skill_results s ON s.id=picked.value
      JOIN artifacts a ON a.id=s.artifact_id AND a.version=s.artifact_version
      WHERE s.status='ready' AND a.ingestion_status='ready' ORDER BY CAST(picked.key AS INTEGER)`,[JSON.stringify(ids)]);
    return uniqueSlugs(rows.map(rowToSkill));
  }
  async finish(c: BriefClaim, brief: HandoffBrief, prompts: unknown, revision: string) {
    const { rowCount } = await this.db.query(`UPDATE agent_briefs SET status='ready',brief=?3,prompts=?4,prompt_revision=?5,error=NULL,updated_at=${NOW}
      WHERE id=?1 AND claim_token=?2 AND status='running'`,[c.id,c.token,JSON.stringify(brief),JSON.stringify(prompts),revision]);
    return rowCount===1;
  }
  async fail(c: BriefClaim, error: string) {
    const { rowCount } = await this.db.query(`UPDATE agent_briefs SET status='failed',error=?3,updated_at=${NOW}
      WHERE id=?1 AND claim_token=?2 AND status='running'`,[c.id,c.token,error.slice(0,2000)]);
    return rowCount===1;
  }
}

type Row = { skill_result_ids: string[]; status: "pending" | "running" | "ready" | "failed"; brief?: HandoffBrief; prompts?: unknown; error?: string; token?: string };

/** In-memory stand-in for tests. */
export class MemoryHandoffStore implements HandoffStore {
  briefs = new Map<string, Row>();
  skills = new Map<string, HandoffSkill>();
  async claim(id: string) {
    const b = this.briefs.get(id);
    if (!b || b.status !== "pending") return null;
    Object.assign(b, { status: "running", token: randomUUID() });
    return { id, token: b.token!, skill_result_ids: b.skill_result_ids };
  }
  /** Test hook: what a newer worker's claim of a stale brief does. */
  takeOver(id: string) { this.briefs.get(id)!.token = randomUUID(); }
  private held(c: BriefClaim) {
    const b = this.briefs.get(c.id);
    return b && b.status === "running" && b.token === c.token ? b : null;
  }
  async loadSkills(ids: string[]) { return uniqueSlugs(ids.map((id) => this.skills.get(id)).filter((s): s is HandoffSkill => !!s)); }
  async finish(c: BriefClaim, brief: HandoffBrief, prompts: unknown) {
    const b = this.held(c);
    if (b) Object.assign(b, { status: "ready", brief, prompts });
    return !!b;
  }
  async fail(c: BriefClaim, error: string) {
    const b = this.held(c);
    if (b) Object.assign(b, { status: "failed", error });
    return !!b;
  }
}
