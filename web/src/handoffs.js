// The last step: the skills a user picks become one prompt for their coding agent (agent_briefs, migration 006).
// The Worker queues the brief and asks the processor to write it; the processor merges the skills (they often come
// from several videos), orders the tasks, and stores a prompt for every agent and mode. Copying is an export, not
// a delivery receipt.

import { processorFetch } from "./processor.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SKILLS = 12;
/** Changing the processor's handoff prompt (HANDOFF_PROMPT_REVISION) should change this, so picks are rewritten. */
export const HANDOFF_REVISION = "handoff-v5";
/** A brief still `running` after this was abandoned by its processor (its STALE_BRIEF_MINUTES) and is requested again. */
const STALE_MS = 25 * 60_000;
/** A `pending` brief the processor hasn't picked up after this was probably never received. */
const UNCLAIMED_MS = 2 * 60_000;

/** True when the page should offer to ask again: never picked up, or abandoned mid-way. */
export function isStuck(row, now = Date.now()) {
  const age = now - new Date(row.updated_at).getTime();
  return (row.status === "pending" && age > UNCLAIMED_MS) || (row.status === "running" && age > STALE_MS);
}

export function parseHandoff(body) {
  const ids = Array.isArray(body?.skill_ids) ? [...new Set(body.skill_ids)] : [];
  if (ids.length === 0) return { ok: false, error: "Pick at least one skill." };
  if (ids.length > MAX_SKILLS) return { ok: false, error: `Pick up to ${MAX_SKILLS} skills.` };
  if (!ids.every((id) => typeof id === "string" && UUID.test(id))) return { ok: false, error: "Those skills weren't recognised." };
  return { ok: true, value: { skill_ids: ids } };
}

/** The same skill revisions picked again reuse their brief; a regenerated skill or a new prompt revision doesn't. */
export const inputKey = (skills) =>
  [...skills].map((s) => `${s.id}@${new Date(s.updated_at).getTime()}`).sort().join(",") + `|${HANDOFF_REVISION}`;

/** POSTs { brief_id } next to PROCESSOR_URL (…/api/ingest/handoff). Same outcomes as requestProcessing. */
export async function requestHandoff(env, briefId, fetchImpl = fetch) {
  if (!env.PROCESSOR_URL) return "not_configured";
  try {
    const res = await processorFetch(env, fetchImpl)(new URL("handoff", env.PROCESSOR_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.PROCESSOR_TOKEN ? { authorization: `Bearer ${env.PROCESSOR_TOKEN}` } : {}),
      },
      body: JSON.stringify({ brief_id: briefId }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? "requested" : "unavailable";
  } catch {
    return "unavailable";
  }
}


/**
 * Queues (or reuses) the brief for these skills. Every skill must be ready and built only from the user's own imports
 * (an artifact that also used someone else's video isn't theirs to hand off, as in /api/skills).
 * Returns { error } with a status, or { brief, processor }.
 */
export async function createHandoff(sql, env, user, unitIds, skillIds, fetchImpl = fetch) {
  if (unitIds.length === 0) return { status: 400, error: "Import a video first." };
  const list = JSON.stringify(unitIds);
  const picked = JSON.stringify(skillIds);
  const skills = await sql`
    SELECT s.id, s.updated_at FROM skill_results s
    JOIN artifacts a ON a.id = s.artifact_id AND a.version = s.artifact_version
    WHERE s.id IN (SELECT value FROM json_each(${picked})) AND s.status = 'ready' AND a.ingestion_status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) WHERE value NOT IN (SELECT value FROM json_each(${list})))`;
  if (skills.length !== skillIds.length) return { status: 400, error: "Some of those skills aren't ready, or aren't from your videos." };

  // A failed brief is retried; one that's ready or still being written is returned as it is.
  const [row] = await sql`
    INSERT INTO agent_briefs (user_id, skill_result_ids, input_key)
    VALUES (${user.id}, ${picked}, ${inputKey(skills)})
    ON CONFLICT (user_id, input_key) DO UPDATE SET
      status = CASE WHEN agent_briefs.status = 'failed' THEN 'pending' ELSE agent_briefs.status END,
      error = CASE WHEN agent_briefs.status = 'failed' THEN NULL ELSE agent_briefs.error END,
      updated_at = CASE WHEN agent_briefs.status = 'failed' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE agent_briefs.updated_at END
    RETURNING id, status, error, skill_result_ids, brief, prompts, prompt_revision, updated_at`;
  const processor = row.status === "pending" || isStuck(row) ? await requestHandoff(env, row.id, fetchImpl) : "not_needed";
  return { brief: serializeBrief(row), processor };
}

/** The user's brief by id, or their newest one. Null when there isn't one. */
export async function readHandoff(sql, user, id = null) {
  const [row] = id
    ? await sql`SELECT id, status, error, skill_result_ids, brief, prompts, prompt_revision, updated_at FROM agent_briefs WHERE id = ${id} AND user_id = ${user.id}`
    : await sql`SELECT id, status, error, skill_result_ids, brief, prompts, prompt_revision, updated_at FROM agent_briefs WHERE user_id = ${user.id} ORDER BY created_at DESC, id DESC LIMIT 1`;
  return row ? serializeBrief(row) : null;
}

const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);

export function serializeBrief(row) {
  const ready = row.status === "ready" && row.prompts && typeof row.prompts === "object";
  const b = ready ? row.brief ?? {} : {};
  return {
    id: row.id,
    status: row.status,
    error: row.status === "failed" ? row.error ?? null : null,
    stuck: isStuck(row),
    skill_ids: row.skill_result_ids ?? [],
    title: ready && typeof b.title === "string" ? b.title : null,
    summary: ready && typeof b.summary === "string" ? b.summary : null,
    themes: ready && Array.isArray(b.themes) ? b.themes.map((t) => ({ name: String(t.name ?? ""), skills: strings(t.skills) })) : [],
    tensions: ready && Array.isArray(b.tensions) ? b.tensions.map((t) => String(t.topic ?? "")) : [],
    actions: ready && Array.isArray(b.actions) ? b.actions.map((a) => ({ title: String(a.title ?? ""), skills: strings(a.skills) })) : [],
    // { claude, codex, cursor, hermes } x { review, apply }: switching agent or mode is instant.
    prompts: ready ? row.prompts : null,
  };
}
