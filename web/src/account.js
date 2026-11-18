import { isMediaKey } from "./media.js";

const json = (values) => JSON.stringify(values);

const ownedUnitIds = `SELECT owned.unit_id FROM user_imports owned
  WHERE owned.user_id = ? AND NOT EXISTS (SELECT 1 FROM user_imports other WHERE other.unit_id = owned.unit_id AND other.user_id <> owned.user_id)`;
const doomedArtifact = (artifact) => `EXISTS (SELECT 1 FROM json_each(${artifact}.source_ids) s WHERE s.value IN (${ownedUnitIds}))`;
const doomedChild = (table) => `EXISTS (SELECT 1 FROM artifacts a
  WHERE a.id = ${table}.artifact_id AND a.version = ${table}.artifact_version AND ${doomedArtifact("a")})`;

export async function deleteAccount(env, sql, userId) {
  const unitIds = (await sql`SELECT unit_id FROM user_imports WHERE user_id = ${userId}`).map((r) => r.unit_id);
  const sharedUnitIds = new Set((await sql`
    SELECT DISTINCT unit_id FROM user_imports
    WHERE user_id <> ${userId} AND unit_id IN (SELECT value FROM json_each(${json(unitIds)}))`).map((r) => r.unit_id));
  const deletedUnitIds = unitIds.filter((id) => !sharedUnitIds.has(id));

  const doomed = await sql`
    SELECT id, version FROM artifacts
    WHERE EXISTS (SELECT 1 FROM json_each(source_ids) s WHERE s.value IN (SELECT value FROM json_each(${json(deletedUnitIds)})))`;
  const artifactPairs = json(doomed.map((a) => ({ id: a.id, version: a.version })));

  const mediaRows = await sql`
    SELECT v.media_ref, v.caption_ref, v.narration_ref, v.music_ref FROM video_results v
    WHERE EXISTS (SELECT 1 FROM json_each(${artifactPairs}) p
      WHERE v.artifact_id = json_extract(p.value, '$.id') AND v.artifact_version = json_extract(p.value, '$.version'))`;
  const mediaKeys = [...new Set(mediaRows.flatMap((row) => Object.values(row))
    .filter((ref) => typeof ref === "string" && ref.startsWith("r2:"))
    .map((ref) => ref.slice(3))
    .filter(isMediaKey))];
  await Promise.all(mediaKeys.map((key) => env.MEDIA.delete(key)));

  await env.DB.batch([
    env.DB.prepare(`
      DELETE FROM handoffs WHERE EXISTS (SELECT 1 FROM skill_results s JOIN artifacts a ON a.id = s.artifact_id AND a.version = s.artifact_version
        WHERE s.id = handoffs.skill_result_id AND ${doomedArtifact("a")})`).bind(userId),
    env.DB.prepare(`DELETE FROM skill_results WHERE ${doomedChild("skill_results")}`).bind(userId),
    env.DB.prepare(`DELETE FROM video_results WHERE ${doomedChild("video_results")}`).bind(userId),
    env.DB.prepare(`DELETE FROM video_starts WHERE ${doomedChild("video_starts")}`).bind(userId),
    env.DB.prepare(`DELETE FROM user_skill_choices WHERE ${doomedChild("user_skill_choices")}`).bind(userId),
    env.DB.prepare(`DELETE FROM user_video_requests WHERE ${doomedChild("user_video_requests")}`).bind(userId),
    env.DB.prepare(`DELETE FROM artifacts WHERE ${doomedArtifact("artifacts")}`).bind(userId),
    env.DB.prepare(`UPDATE ingested_units SET submitted_url = source_url
      WHERE id IN (SELECT unit_id FROM user_imports WHERE user_id = ?)`).bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    env.DB.prepare("DELETE FROM x_read_requests WHERE user_key = ?").bind(userId),
    env.DB.prepare("DELETE FROM artifact_exclusions WHERE unit_id IN (SELECT value FROM json_each(?))").bind(json(deletedUnitIds)),
    env.DB.prepare("DELETE FROM ingested_units WHERE id IN (SELECT value FROM json_each(?))").bind(json(deletedUnitIds)),
  ]);
}
