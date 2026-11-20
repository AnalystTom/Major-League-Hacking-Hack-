import { requestHandoff } from "./processor.js";
import { SKILL_PROMPT_REVISION } from "./skill-policy.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SKILLS = 12;
export const HANDOFF_REVISION = "handoff-v5";
const ABANDONED_RUNNING_MS = 25 * 60_000;
const UNCLAIMED_PENDING_MS = 2 * 60_000;

export function isStuck(row, now = Date.now()) {
  const age = now - new Date(row.updated_at).getTime();
  return (row.status === "pending" && age > UNCLAIMED_PENDING_MS) || (row.status === "running" && age > ABANDONED_RUNNING_MS);
}

export function parseHandoff(body) {
  const ids = Array.isArray(body?.skill_ids) ? [...new Set(body.skill_ids)] : [];
  if (ids.length === 0) return { ok: false, error: "Pick at least one skill." };
  if (ids.length > MAX_SKILLS) return { ok: false, error: `Pick up to ${MAX_SKILLS} skills.` };
  if (!ids.every((id) => typeof id === "string" && UUID.test(id))) return { ok: false, error: "Those skills weren't recognised." };
  return { ok: true, value: { skill_ids: ids } };
}

export const inputKey = (skills) =>
  [...skills].map((s) => `${s.id}@${new Date(s.updated_at).getTime()}`).sort().join(",") + `|${HANDOFF_REVISION}`;

export async function createHandoff(sql, env, user, unitIds, skillIds, fetchImpl = fetch) {
  if (unitIds.length === 0) return { status: 400, error: "Import a video first." };
  const list = JSON.stringify(unitIds);
  const picked = JSON.stringify(skillIds);
  const skills = await sql`
    SELECT s.id, s.updated_at FROM skill_results s
    JOIN artifacts a ON a.id = s.artifact_id AND a.version = s.artifact_version
    WHERE s.id IN (SELECT value FROM json_each(${picked})) AND s.status = 'ready' AND a.ingestion_status = 'ready'
      AND json_extract(iif(json_valid(s.review_feedback),s.review_feedback,'{}'),'$.prompt_revision')=${SKILL_PROMPT_REVISION}
      AND NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) WHERE value NOT IN (SELECT value FROM json_each(${list})))`;
  if (skills.length !== skillIds.length) return { status: 400, error: "Some of those skills aren't ready, or aren't from your videos." };

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
    prompts: ready ? row.prompts : null,
  };
}
