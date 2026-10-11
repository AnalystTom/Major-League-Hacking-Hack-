// Proceed: pasted YouTube and Substack links become ingested units in TigerData, and their progress is read back
// from the units, artifacts and video results the processor writes. Nothing here invents progress.

import { isSubstackHost, parseSubstackLink } from "./substack.js";
import { parseYouTubeLink } from "./youtube.js";

export const MAX_LINKS = 10;
export const MAX_LINK_LENGTH = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Substack hosts go to the Substack parser; everything else is judged as a YouTube link.
function parseLink(line) {
  let host = "";
  try {
    host = new URL(/^https?:\/\//i.test(line.trim()) ? line.trim() : `https://${line.trim()}`).hostname.toLowerCase();
  } catch {}
  return isSubstackHost(host) ? parseSubstackLink(line) : parseYouTubeLink(line);
}

/** Validates a Proceed submission: { links: string[] | string, company?: honeypot }. */
export function parseImport(body) {
  if (!body || typeof body !== "object") return { ok: false, status: 400, error: "Send a JSON body with a links field." };
  if (typeof body.company === "string" && body.company.trim() !== "") return { ok: false, status: 202, error: "ignored" };

  const raw = Array.isArray(body.links) ? body.links : typeof body.links === "string" ? body.links.split(/\s+/) : [];
  if (raw.length > MAX_LINKS * 4) return { ok: false, status: 400, error: `Paste at most ${MAX_LINKS} links at a time.` };
  const lines = raw.filter((l) => typeof l === "string" && l.trim() !== "");
  if (lines.length === 0) return { ok: false, status: 400, error: "Paste at least one YouTube or Substack link." };
  if (lines.length > MAX_LINKS) return { ok: false, status: 400, error: `Paste at most ${MAX_LINKS} links at a time.` };
  if (lines.some((l) => l.length > MAX_LINK_LENGTH)) return { ok: false, status: 400, error: "One of those links is too long." };

  const links = [];
  const invalid = [];
  for (const line of lines) {
    const parsed = parseLink(line);
    if (parsed.ok) links.push(parsed.value);
    else invalid.push({ link: line.trim(), error: parsed.error });
  }
  if (invalid.length) return { ok: false, status: 400, error: "Some links can't be imported.", invalid };

  // The same video at the same start time is one unit.
  const seen = new Set();
  const unique = links.filter((l) => {
    const key = `${l.source_url}@${l.start_seconds}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  return { ok: true, value: { links: unique } };
}

/** Comma-separated unit ids from a query string, or null when any id is malformed. */
export function parseUnitIds(value) {
  const ids = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_LINKS || !ids.every((id) => UUID.test(id))) return null;
  return ids;
}

/**
 * Reuses the newest unit for the same video and start time unless it failed, otherwise inserts a
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
        AND start_seconds IS NOT DISTINCT FROM ${link.start_seconds}::integer
        AND status <> 'failed'
      ORDER BY created_at DESC LIMIT 1`;
    const [unit] = existing
      ? [{ ...existing, reused: true }]
      : (await sql`
          INSERT INTO ingested_units (submitted_url, source_url, start_seconds, content_type)
          VALUES (${link.submitted_url}, ${link.source_url}, ${link.start_seconds}::integer, ${link.content_type ?? "youtube_video"})
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
 * shared, so everyone who imported a video sees the same artifacts for it.
 */
export async function readUnits(sql, ids) {
  if (ids.length === 0) return [];
  const list = ids.join(",");
  const rows = await sql`
    SELECT u.id, u.source_url, u.start_seconds, u.title, u.status, u.error,
      COALESCE((SELECT json_agg(e.reason ORDER BY e.created_at) FROM artifact_exclusions e WHERE e.unit_id = u.id), '[]') AS exclusions,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', a.id, 'version', a.version, 'name', a.name,
          'ingestion_status', a.ingestion_status, 'error', a.error,
          'video', (
            SELECT json_build_object('status', v.status, 'error', v.error)
            FROM video_results v
            WHERE v.artifact_id = a.id AND v.artifact_version = a.version
            ORDER BY v.created_at DESC, v.id DESC LIMIT 1)
        ) ORDER BY a.created_at)
        FROM artifacts a
        WHERE u.id = ANY (a.source_ids)), '[]') AS artifacts
    FROM ingested_units u
    WHERE u.id = ANY (string_to_array(${list}, ',')::uuid[])
    ORDER BY array_position(string_to_array(${list}, ',')::uuid[], u.id)`;
  return rows.map(describeUnit);
}

/**
 * Collapses a unit's records into the one stage the page shows. `settled` means nothing more will
 * happen automatically: a failure, an exclusion, or a ready clip.
 */
export function describeUnit(row) {
  const base = {
    id: row.id,
    source_url: row.source_url,
    start_seconds: row.start_seconds,
    title: row.title ?? null,
  };
  const at = (stage, settled, error = null) => ({ ...base, stage, settled, error });

  if (row.status === "pending") return at("queued", false);
  if (row.status === "running") return at("fetching", false);
  if (row.status === "failed") return at("failed", true, row.error ?? null);

  const artifacts = row.artifacts ?? [];
  if (artifacts.length === 0) {
    return (row.exclusions ?? []).length ? at("not_selected", true, row.exclusions.join(" ")) : at("digesting", false);
  }

  // A unit can feed several artifacts; report the one furthest along.
  const stages = artifacts.map((a) => {
    const v = a.video;
    if (a.ingestion_status === "failed") return at("failed", true, a.error ?? null);
    if (a.ingestion_status !== "ready") return at("digesting", false);
    if (!v || v.status === "pending" || v.status === "running") return at("rendering", false);
    if (v.status === "failed") return at("render_failed", true, v.error ?? null);
    return at("ready", true);
  });
  const rank = ["failed", "render_failed", "digesting", "rendering", "ready"];
  return stages.reduce((best, s) => (rank.indexOf(s.stage) > rank.indexOf(best.stage) ? s : best));
}
