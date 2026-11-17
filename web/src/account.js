import { isMediaKey } from "./media.js";

const artifactKey = (row) => `${row.id}@${row.version}`;
const json = (values) => JSON.stringify(values);

export async function deleteAccount(env, sql, userId) {
  const unitIds = (await sql`SELECT unit_id FROM user_imports WHERE user_id = ${userId}`).map((r) => r.unit_id);
  const sharedUnitIds = new Set((await sql`
    SELECT DISTINCT unit_id FROM user_imports
    WHERE user_id <> ${userId} AND unit_id IN (SELECT value FROM json_each(${json(unitIds)}))`).map((r) => r.unit_id));
  const ownedUnitIds = unitIds.filter((id) => !sharedUnitIds.has(id));
  const ownedSet = new Set(ownedUnitIds);

  const touched = await sql`
    SELECT id, version, source_ids FROM artifacts
    WHERE EXISTS (SELECT 1 FROM json_each(source_ids) s WHERE s.value IN (SELECT value FROM json_each(${json(unitIds)})))`;
  const doomed = touched.filter((a) => a.source_ids.every((id) => ownedSet.has(id)));
  const doomedKeys = new Set(doomed.map(artifactKey));
  const keptUnitIds = new Set(touched.filter((a) => !doomedKeys.has(artifactKey(a))).flatMap((a) => a.source_ids));
  const deletedUnitIds = ownedUnitIds.filter((id) => !keptUnitIds.has(id));

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

  const forDoomedArtifacts = (table) => `
    EXISTS (SELECT 1 FROM json_each(?) p
      WHERE ${table}.artifact_id = json_extract(p.value, '$.id') AND ${table}.artifact_version = json_extract(p.value, '$.version'))`;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    env.DB.prepare(`
      DELETE FROM handoffs WHERE EXISTS (SELECT 1 FROM skill_results s JOIN json_each(?) p
        ON s.artifact_id = json_extract(p.value, '$.id') AND s.artifact_version = json_extract(p.value, '$.version')
        WHERE s.id = handoffs.skill_result_id)`).bind(artifactPairs),
    env.DB.prepare(`DELETE FROM skill_results WHERE ${forDoomedArtifacts("skill_results")}`).bind(artifactPairs),
    env.DB.prepare(`DELETE FROM video_results WHERE ${forDoomedArtifacts("video_results")}`).bind(artifactPairs),
    env.DB.prepare(`DELETE FROM video_starts WHERE ${forDoomedArtifacts("video_starts")}`).bind(artifactPairs),
    env.DB.prepare(`DELETE FROM user_skill_choices WHERE ${forDoomedArtifacts("user_skill_choices")}`).bind(artifactPairs),
    env.DB.prepare(`DELETE FROM user_video_requests WHERE ${forDoomedArtifacts("user_video_requests")}`).bind(artifactPairs),
    env.DB.prepare(`
      DELETE FROM artifacts WHERE EXISTS (SELECT 1 FROM json_each(?) p
        WHERE artifacts.id = json_extract(p.value, '$.id') AND artifacts.version = json_extract(p.value, '$.version'))`).bind(artifactPairs),
    env.DB.prepare("DELETE FROM artifact_exclusions WHERE unit_id IN (SELECT value FROM json_each(?))").bind(json(deletedUnitIds)),
    env.DB.prepare("DELETE FROM ingested_units WHERE id IN (SELECT value FROM json_each(?))").bind(json(deletedUnitIds)),
  ]);
}
