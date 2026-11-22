import { skillStatus } from "./skill-policy.js";
import { dedupeContent, sourceKey } from "./content.js";
import { isSubstackHost, parseSubstackLink } from "./substack.js";
import { isXLink, parseXLink } from "./xpost.js";
import { parseYouTubeLink } from "./youtube.js";

export const MAX_YOUTUBE_LINKS = 20;
export const MAX_X_LINKS = 100;
export const MAX_SUBSTACK_LINKS = 20;
export const MAX_LINKS = MAX_YOUTUBE_LINKS + MAX_X_LINKS + MAX_SUBSTACK_LINKS;
export const MAX_LINK_LENGTH = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hostOf(line) {
  try {
    const s = line.trim();
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function parseImport(body) {
  if (!body || typeof body !== "object") return { ok: false, status: 400, error: "Send a JSON body with a links field." };
  if (typeof body.company === "string" && body.company.trim() !== "") return { ok: false, status: 202, error: "ignored" };

  const raw = Array.isArray(body.links) ? body.links : typeof body.links === "string" ? body.links.split(/\s+/) : [];
  if (raw.length > MAX_LINKS * 4) return { ok: false, status: 400, error: `Paste at most ${MAX_LINKS} links at a time.` };
  const lines = raw.filter((l) => typeof l === "string" && l.trim() !== "");
  if (lines.length === 0) return { ok: false, status: 400, error: "Paste at least one YouTube, X post or Substack link." };
  if (lines.length > MAX_LINKS) return { ok: false, status: 400, error: `Paste at most ${MAX_YOUTUBE_LINKS} YouTube videos, ${MAX_X_LINKS} X posts and ${MAX_SUBSTACK_LINKS} Substack posts at a time.` };
  if (lines.some((l) => l.length > MAX_LINK_LENGTH)) return { ok: false, status: 400, error: "One of those links is too long." };

  const links = [];
  const invalid = [];
  for (const line of lines) {
    const parsed = isXLink(line) ? parseXLink(line) : isSubstackHost(hostOf(line)) ? parseSubstackLink(line) : parseYouTubeLink(line);
    if (parsed.ok) links.push(parsed.value);
    else invalid.push({ link: line.trim(), error: parsed.error });
  }
  if (invalid.length && !links.length) return { ok: false, status: 400, error: "None of those links can be imported.", invalid };

  const seen = new Set();
  const unique = links.filter((l) => {
    const key = sourceKey(l.source_url, l.start_seconds);
    return seen.has(key) ? false : (seen.add(key), true);
  });
  const count = (type) => unique.filter((l) => (l.content_type ?? "youtube_video") === type).length;
  if (count("youtube_video") > MAX_YOUTUBE_LINKS) return { ok: false, status: 400, error: `Paste at most ${MAX_YOUTUBE_LINKS} YouTube videos at a time.` };
  if (count("x_post") > MAX_X_LINKS) return { ok: false, status: 400, error: `Paste at most ${MAX_X_LINKS} X posts at a time.` };
  if (count("substack_post") > MAX_SUBSTACK_LINKS) return { ok: false, status: 400, error: `Paste at most ${MAX_SUBSTACK_LINKS} Substack posts at a time.` };
  return { ok: true, value: { links: unique, invalid } };
}

export function parseUnitIds(value) {
  const ids = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_LINKS || !ids.every((id) => UUID.test(id))) return null;
  return ids;
}

async function ownedUnit(sql, userId, link) {
  if (!userId) return null;
  return (await sql`SELECT u.id,u.status FROM user_imports ui JOIN ingested_units u ON u.id=ui.unit_id
    WHERE ui.user_id=${userId} AND u.source_url=${link.source_url} AND u.status<>'failed'
      AND u.start_seconds IS ${link.start_seconds}
      AND (${link.content_type ?? "youtube_video"}<>'x_post' OR u.status IN ('pending','running')
        OR u.extraction_method IN ('twitterapi.io:tweets:v2','x-embed:tweet-result:v2'))
    ORDER BY ui.created_at DESC LIMIT 1`)[0] ?? null;
}

export async function createUnits(sql, links, { userId = null } = {}) {
  const units = [];
  for (const link of links) {
    const owned = await ownedUnit(sql, userId, link);
    const [existing] = owned ? [owned] : await sql`
      SELECT id, status FROM ingested_units
      WHERE source_url = ${link.source_url}
        AND start_seconds IS ${link.start_seconds}
        AND status <> 'failed'
        AND (${link.content_type ?? "youtube_video"} <> 'x_post' OR status IN ('pending','running')
          OR extraction_method IN ('twitterapi.io:tweets:v2','x-embed:tweet-result:v2'))
      ORDER BY created_at DESC LIMIT 1`;
    const [unit] = existing
      ? [{ ...existing, reused: true }]
      : (await sql`
          INSERT INTO ingested_units (submitted_url, source_url, start_seconds, content_type)
          SELECT ${link.submitted_url}, ${link.source_url}, ${link.start_seconds}, ${link.content_type ?? "youtube_video"}
          WHERE NOT EXISTS (SELECT 1 FROM ingested_units WHERE source_url=${link.source_url} AND start_seconds IS ${link.start_seconds}
            AND (status IN ('pending','running') OR (status='ready' AND (${link.content_type ?? "youtube_video"}<>'x_post'
              OR extraction_method IN ('twitterapi.io:tweets:v2','x-embed:tweet-result:v2')))))
          RETURNING id, status`).map((u) => ({ ...u, reused: false }));
    let resolved = unit ?? (await sql`SELECT id,status FROM ingested_units WHERE source_url=${link.source_url}
      AND start_seconds IS ${link.start_seconds} AND status<>'failed' ORDER BY created_at DESC LIMIT 1`)[0];
    if (userId) {
      let linked;
      try {
        linked = await sql`
          INSERT INTO user_imports (user_id, unit_id)
          SELECT ${userId}, ${resolved.id}
          WHERE NOT EXISTS (SELECT 1 FROM user_imports ui JOIN ingested_units u ON u.id=ui.unit_id
            WHERE ui.user_id=${userId} AND u.source_url=${link.source_url} AND u.status<>'failed'
              AND u.start_seconds IS ${link.start_seconds}
              AND (${link.content_type ?? "youtube_video"}<>'x_post' OR u.status IN ('pending','running')
                OR u.extraction_method IN ('twitterapi.io:tweets:v2','x-embed:tweet-result:v2')))
          ON CONFLICT (user_id, unit_id) DO NOTHING
          RETURNING unit_id`;
      } catch (error) {
        if (unit?.reused === false) await sql`DELETE FROM ingested_units WHERE id = ${resolved.id}
          AND NOT EXISTS (SELECT 1 FROM users WHERE id = ${userId})
          AND NOT EXISTS (SELECT 1 FROM user_imports WHERE unit_id = ${resolved.id})`;
        throw error;
      }
      resolved = linked.length ? { ...resolved, linked: true } : { ...(await ownedUnit(sql, userId, link)), reused: true, linked: false };
    }
    units.push(resolved);
  }
  return units;
}

export async function userUnitIds(sql, userId) {
  const rows = await sql`
    SELECT unit_id FROM user_imports WHERE user_id = ${userId} ORDER BY created_at DESC`;
  return rows.map((r) => r.unit_id);
}

export async function readUnits(sql, viewer, ids) {
  if (ids.length === 0) return [];
  const visible = await userUnitIds(sql, viewer);
  const rows = await sql`
    SELECT u.id, u.source_url, u.start_seconds, u.title, u.content_type, u.status, u.error, u.deferred_until,
      COALESCE(json_extract(iif(json_valid(u.transcript),u.transcript,'{}'),'$.preview_only'),0)=1 AS preview_only,
      (SELECT json_group_array(reason) FROM
        (SELECT reason FROM artifact_exclusions e WHERE e.unit_id = u.id ORDER BY e.created_at)) AS exclusions,
      (SELECT json_group_array(json(item)) FROM (
        SELECT json_object('id', a.id, 'version', a.version, 'name', a.name,
          'ingestion_status', a.ingestion_status, 'error', a.error,
          'video_requested', EXISTS(SELECT 1 FROM user_video_requests r WHERE r.user_id=${viewer} AND r.artifact_id=a.id AND r.artifact_version=a.version),
          'skill', json((SELECT json_object('status',s.status,'review_feedback',s.review_feedback,'attempts',s.attempts) FROM skill_results s WHERE s.artifact_id=a.id AND s.artifact_version=a.version ORDER BY s.created_at DESC LIMIT 1)),
          'video', json((SELECT json_object('status', v.status, 'error', v.error, 'attempts', v.attempts, 'review_feedback', v.review_feedback)
            FROM video_results v WHERE v.artifact_id = a.id AND v.artifact_version = a.version
            ORDER BY v.created_at DESC, v.id DESC LIMIT 1))) AS item
        FROM artifacts a
        WHERE EXISTS (SELECT 1 FROM json_each(a.source_ids) WHERE value = u.id)
          AND NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) WHERE value NOT IN (SELECT value FROM json_each(${JSON.stringify(visible)})))
        ORDER BY a.created_at)) AS artifacts
    FROM ingested_units u JOIN json_each(${JSON.stringify(ids)}) selected ON selected.value = u.id
    ORDER BY CAST(selected.key AS INTEGER)`;
  return dedupeContent(rows).map((row) => describeUnit(row));
}

export const MAX_OUTPUT_ATTEMPTS = 3;
export const willRetry = (r) => r?.status === "failed" && Number.isInteger(r.attempts) && r.attempts < MAX_OUTPUT_ATTEMPTS;

const TECHNICAL = /^Quality judge|HTTP \d{3}|[{}]|_KEY\b|\bAPI\b|JSON|token|Gemini|OpenAI|twitterapi|Nimble|ffmpeg|chromium|exit(?:ed)? \d|\bgpt-|Digestion/i;
const KNOWN_REASONS = [
  [/NIMBLE_API_KEY is not configured/, "Reading Substack posts isn't switched on yet, so this one can't be read. Try again later."],
  [/^Nimble /, "Couldn't read this Substack post right now. Try again later."],
  [/TWITTERAPI_IO_KEY is not configured|^twitterapi\.io|^X embed/, "Couldn't read this X post right now. Try again later."],
];
export const PLAIN_FAILURE = {
  failed: "Resurface couldn't turn this into a skill.",
  render_failed: "The short couldn't be finished.",
  render_retrying: "The short hit a snag and is being tried again.",
};

export function plainReason(error, stage) {
  if (stage === "failed") for (const [pattern, reason] of KNOWN_REASONS) if (error && pattern.test(error)) return reason;
  return stage !== "not_selected" && error && (error.length > 200 || TECHNICAL.test(error)) ? PLAIN_FAILURE[stage] ?? PLAIN_FAILURE.failed : error;
}

const hasReadySkill = (artifact) => artifact.ingestion_status === "ready" && skillStatus(artifact.skill?.status, artifact.skill?.review_feedback) === "ready";

const shortPassedReview = (video) => {
  let judgment;
  try { judgment = JSON.parse(video?.review_feedback ?? "null"); } catch {}
  return video?.status === "ready" && judgment?.judge === "short-judge-v1" && judgment.passed === true && judgment.captions_burned === true;
};

function skillStage(a, at) {
  if (shortPassedReview(a.video)) return at("ready", true);
  if (hasReadySkill(a)) return at("skill_ready", true);
  if (a.skill?.status === "failed" && !willRetry(a.skill)) return at("failed", true, PLAIN_FAILURE.failed);
  return at("writing_skill", false);
}

function requestedVideoStage(a, at) {
  const v = a.video;
  const unfinished = !v || v.status === "pending" || v.status === "running";
  if (hasReadySkill(a) && unfinished) return at("skill_ready", true);
  if (unfinished) return at("rendering", false);
  if (willRetry(v)) return at("render_retrying", false, v.error ?? null);
  if (v.status === "failed") return at("render_failed", true, v.error ?? null);
  return shortPassedReview(v) ? at("ready", true) : at("reviewing", false);
}

export function describeUnit(row, now = new Date()) {
  const base = {
    id: row.id,
    source_url: row.source_url,
    start_seconds: row.start_seconds,
    title: row.title ?? null,
    content_type: row.content_type ?? "youtube_video",
    preview_only: row.preview_only === 1 || row.preview_only === true,
    skill_ready: (row.artifacts ?? []).some(hasReadySkill),
  };
  const at = (stage, settled, error = null) => ({ ...base, stage, settled, error: plainReason(error, stage) });

  const until = row.deferred_until ? new Date(row.deferred_until) : null;
  const limited = () => at("limited", true, `Resurface has reached its processing limit for now. This link starts after ${until.toISOString().slice(0, 16).replace("T", " ")} UTC.`);
  const held = until !== null && until > now;

  if (row.status === "pending") return held ? limited() : at("queued", false);
  if (row.status === "running") return at("fetching", false);
  if (row.status === "failed") return at("failed", true, row.error ?? null);

  const artifacts = row.artifacts ?? [];
  if (artifacts.length === 0) {
    if ((row.exclusions ?? []).length) return at("not_selected", true, row.exclusions.join(" "));
    return held ? limited() : at("digesting", false);
  }

  const stages = artifacts.map((a) => {
    if (a.ingestion_status === "failed") return at("failed", true, a.error ?? null);
    if (a.ingestion_status !== "ready") return at("digesting", false);
    return a.video_requested ? requestedVideoStage(a, at) : skillStage(a, at);
  });
  const rank = ["failed", "render_failed", "digesting", "writing_skill", "render_retrying", "rendering", "reviewing", "skill_ready", "ready"];
  return stages.reduce((best, s) => (rank.indexOf(s.stage) > rank.indexOf(best.stage) ? s : best));
}
