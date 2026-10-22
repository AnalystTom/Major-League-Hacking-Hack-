// Proceed: pasted YouTube and X post links become ingested units in D1, and their progress is read back
// from the units, artifacts and video results the processor writes. Nothing here invents progress.

import { isSubstackHost, parseSubstackLink } from "./substack.js";
import { isXLink, parseXLink } from "./xpost.js";
import { parseYouTubeLink } from "./youtube.js";
import { activePromptId } from "./processor.js";

// Per source type: a video costs a long Gemini read, an X post one cheap API read.
export const MAX_YOUTUBE_LINKS = 20;
export const MAX_X_LINKS = 100;
export const MAX_SUBSTACK_LINKS = 20; // a post is one Nimble read plus a long digest input
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

/** Validates a Proceed submission: { links: string[] | string, company?: honeypot }. */
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
  if (invalid.length) return { ok: false, status: 400, error: "Some links can't be imported.", invalid };

  // The same video at the same start time (or the same post) is one unit.
  const seen = new Set();
  const unique = links.filter((l) => {
    const key = `${l.source_url}@${l.start_seconds}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  const count = (type) => unique.filter((l) => (l.content_type ?? "youtube_video") === type).length;
  if (count("youtube_video") > MAX_YOUTUBE_LINKS) return { ok: false, status: 400, error: `Paste at most ${MAX_YOUTUBE_LINKS} YouTube videos at a time.` };
  if (count("x_post") > MAX_X_LINKS) return { ok: false, status: 400, error: `Paste at most ${MAX_X_LINKS} X posts at a time.` };
  if (count("substack_post") > MAX_SUBSTACK_LINKS) return { ok: false, status: 400, error: `Paste at most ${MAX_SUBSTACK_LINKS} Substack posts at a time.` };
  return { ok: true, value: { links: unique } };
}

/** Comma-separated unit ids from a query string, or null when any id is malformed. */
export function parseUnitIds(value) {
  const ids = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_LINKS || !ids.every((id) => UUID.test(id))) return null;
  return ids;
}

/**
 * Reuses the newest unit for the same video (or X post) and start time unless it failed, otherwise inserts a
 * pending one. Reuse means an already processed video shows its results instead of paying for a rerun.
 * Only ids and status come back: a reused unit's submitted_url is another visitor's original link,
 * which can carry their share or playlist parameters, so it never leaves the database.
 */
export async function createUnits(sql, links, { userId = null } = {}) {
  const units = [];
  for (const link of links) {
    const [existing] = await sql`
      SELECT id, status FROM ingested_units
      WHERE source_url = ${link.source_url}
        AND start_seconds IS ${link.start_seconds}
        AND status <> 'failed'
      ORDER BY created_at DESC LIMIT 1`;
    const [unit] = existing
      ? [{ ...existing, reused: true }]
      : (await sql`
          INSERT INTO ingested_units (submitted_url, source_url, start_seconds, content_type)
          VALUES (${link.submitted_url}, ${link.source_url}, ${link.start_seconds}, ${link.content_type ?? "youtube_video"})
          RETURNING id, status`).map((u) => ({ ...u, reused: false }));
    if (userId) {
      // `linked` is true the first time this user imports the unit, which is when the processor is asked.
      const linked = await sql`
        INSERT INTO user_imports (user_id, unit_id)
        VALUES (${userId}, ${unit.id})
        ON CONFLICT (user_id, unit_id) DO NOTHING
        RETURNING unit_id`;
      unit.linked = linked.length > 0;
    }
    units.push(unit);
  }
  return units;
}

/** The ids of everything a user has imported, newest first. */
export async function userUnitIds(sql, userId, limit = 50) {
  const rows = await sql`
    SELECT unit_id FROM user_imports WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => r.unit_id);
}

/**
 * Each unit with the artifacts it fed, their newest video result, and any exclusion reasons. Digests are
 * shared, but an artifact only counts when it's built entirely from videos in `visible` (all of the user's
 * imports), the same rule as the feed and skills, so a link's stage matches what the user can actually open.
 */
export async function readUnits(sql, ids, visible = ids, env) {
  if (ids.length === 0) return [];
  const promptId = await activePromptId(env);
  const rows = await sql`
    SELECT u.id, u.source_url, u.start_seconds, u.title, u.content_type, u.status, u.error, u.deferred_until,
      (SELECT count(*) FROM artifacts a WHERE a.ingestion_status = 'failed'
        AND EXISTS (SELECT 1 FROM json_each(a.source_ids) WHERE value = u.id)) AS digest_failures,
      (SELECT json_group_array(reason) FROM
        (SELECT reason FROM artifact_exclusions e WHERE e.unit_id = u.id
          AND (${promptId === undefined ? 0 : 1} = 0 OR e.digestion_prompt_id = ${promptId ?? null})
          AND NOT EXISTS (SELECT 1 FROM processing_starts d WHERE d.unit_id = u.id AND d.kind = 'digest'
            AND julianday(d.created_at) > julianday(e.created_at))
          ORDER BY e.created_at)) AS exclusions,
      (SELECT json_group_array(json(item)) FROM (
        SELECT json_object('id', a.id, 'version', a.version, 'name', a.name,
          'ingestion_status', a.ingestion_status, 'error', a.error,
          'video', json((SELECT json_object('status', v.status, 'error', v.error, 'attempts', v.attempts)
            FROM video_results v WHERE v.artifact_id = a.id AND v.artifact_version = a.version
            ORDER BY v.created_at DESC, v.id DESC LIMIT 1))) AS item
        FROM artifacts a
        WHERE EXISTS (SELECT 1 FROM json_each(a.source_ids) WHERE value = u.id)
          AND NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) WHERE value NOT IN (SELECT value FROM json_each(${JSON.stringify(visible)})))
          AND (a.ingestion_status <> 'failed' OR NOT EXISTS (
            SELECT 1 FROM processing_starts d WHERE d.unit_id = u.id AND d.kind = 'digest'
              AND julianday(d.created_at) > julianday(a.created_at)))
        ORDER BY a.created_at)) AS artifacts
    FROM ingested_units u JOIN json_each(${JSON.stringify(ids)}) selected ON selected.value = u.id
    ORDER BY CAST(selected.key AS INTEGER)`;
  return rows.map((row) => describeUnit(row));
}

/** The processor's MAX_OUTPUT_ATTEMPTS (server/src/outputs/store.ts): a failed skill or short with attempts left is retried. */
export const MAX_OUTPUT_ATTEMPTS = 3;
export const willRetry = (r) => r?.status === "failed" && Number.isInteger(r.attempts) && r.attempts < MAX_OUTPUT_ATTEMPTS;
const MAX_DIGEST_ATTEMPTS = 3;

// Provider and tool failures (an HTTP status, a JSON body, a key name, an ffmpeg exit) are for the logs, not for people.
const TECHNICAL = /HTTP \d{3}|[{}]|_KEY\b|\bAPI\b|JSON|token|Gemini|OpenAI|twitterapi|Nimble|ffmpeg|chromium|exit(?:ed)? \d|\bgpt-|Digestion/i;
const PLAIN_FAILURE = {
  failed: "Resurface couldn't turn this into a short.",
  render_failed: "The short couldn't be finished.",
  render_retrying: "The short hit a snag and is being tried again.",
};

/**
 * The reason a person sees: the stored one when it is already plain, otherwise a short sentence for the stage.
 * Not-selected reasons are written by the digest for people, so they are never replaced.
 */
export const plainReason = (error, stage) => (stage !== "not_selected" && error && (error.length > 200 || TECHNICAL.test(error)) ? PLAIN_FAILURE[stage] ?? PLAIN_FAILURE.failed : error);

/**
 * Collapses a unit's records into the one stage the page shows. `settled` means nothing more will
 * happen automatically: a failure, an exclusion, or a ready clip.
 */
export function describeUnit(row, now = new Date()) {
  const base = {
    id: row.id,
    source_url: row.source_url,
    start_seconds: row.start_seconds,
    title: row.title ?? null,
    content_type: row.content_type ?? "youtube_video",
  };
  const at = (stage, settled, error = null) => ({ ...base, stage, settled, error: plainReason(error, stage) });

  // Held back by the processor's daily or monthly limit (before reading it, or before digesting a video that's
  // already read): nothing happens before then, so it's settled.
  const until = row.deferred_until ? new Date(row.deferred_until) : null;
  const limited = () => at("limited", true, `Resurface has reached its processing limit for now. This link starts after ${until.toISOString().slice(0, 16).replace("T", " ")} UTC.`);
  const held = until !== null && until > now;

  if (row.status === "pending") return held ? limited() : at("queued", false);
  if (row.status === "running") return at("fetching", false);
  if (row.status === "failed") return at("failed", true, row.error ?? null);

  const artifacts = row.artifacts ?? [];
  const usable = artifacts.filter((a) => a.ingestion_status !== "failed");
  if (usable.length === 0) {
    if ((row.exclusions ?? []).length) return at("not_selected", true, row.exclusions.join(" "));
    if (artifacts.length === 0 || row.digest_failures < MAX_DIGEST_ATTEMPTS) return held ? limited() : at("digesting", false);
  }

  // A unit can feed several artifacts; report the one furthest along.
  const stages = (usable.length ? usable : artifacts).map((a) => {
    const v = a.video;
    if (a.ingestion_status === "failed") return at("failed", true, a.error ?? null);
    if (a.ingestion_status !== "ready") return at("digesting", false);
    if (!v || v.status === "pending" || v.status === "running") return at("rendering", false);
    if (willRetry(v)) return at("render_retrying", false, v.error ?? null);
    if (v.status === "failed") return at("render_failed", true, v.error ?? null);
    return at("ready", true);
  });
  const rank = ["failed", "render_failed", "digesting", "render_retrying", "rendering", "ready"];
  return stages.reduce((best, s) => (rank.indexOf(s.stage) > rank.indexOf(best.stage) ? s : best));
}
