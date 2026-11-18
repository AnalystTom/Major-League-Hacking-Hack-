import { isMediaKey } from "./media.js";

const json = (values) => JSON.stringify(values);

const ownUnits = "SELECT unit_id FROM user_imports WHERE user_id = ?1";
const otherUnits = "SELECT unit_id FROM user_imports WHERE user_id <> ?1";
const soleOwnUnits = `SELECT o.unit_id FROM user_imports o WHERE o.user_id = ?1
  AND NOT EXISTS (SELECT 1 FROM user_imports x WHERE x.unit_id = o.unit_id AND x.user_id <> ?1)`;
const touchesOwn = (artifact) => `EXISTS (SELECT 1 FROM json_each(${artifact}.source_ids) src WHERE src.value IN (${ownUnits}))`;
const removedArtifact = (artifact) => `${touchesOwn(artifact)}
  AND NOT EXISTS (SELECT 1 FROM json_each(${artifact}.source_ids) src WHERE src.value IN (${otherUnits}))`;
const removedChild = (table) => `EXISTS (SELECT 1 FROM artifacts a
  WHERE a.id = ${table}.artifact_id AND a.version = ${table}.artifact_version AND ${removedArtifact("a")})`;

export async function deleteAccount(env, sql, userId) {
  const removed = await sql`
    SELECT a.id, a.version FROM artifacts a
    WHERE EXISTS (SELECT 1 FROM json_each(a.source_ids) src WHERE src.value IN (SELECT unit_id FROM user_imports WHERE user_id = ${userId}))
      AND NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) src WHERE src.value IN (SELECT unit_id FROM user_imports WHERE user_id <> ${userId}))`;
  const artifactPairs = json(removed.map((a) => ({ id: a.id, version: a.version })));

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
        WHERE s.id = handoffs.skill_result_id AND ${removedArtifact("a")})`).bind(userId),
    env.DB.prepare(`DELETE FROM skill_results WHERE ${removedChild("skill_results")}`).bind(userId),
    env.DB.prepare(`DELETE FROM video_results WHERE ${removedChild("video_results")}`).bind(userId),
    env.DB.prepare(`DELETE FROM video_starts WHERE ${removedChild("video_starts")}`).bind(userId),
    env.DB.prepare(`DELETE FROM user_skill_choices WHERE ${removedChild("user_skill_choices")}`).bind(userId),
    env.DB.prepare(`DELETE FROM user_video_requests WHERE ${removedChild("user_video_requests")}`).bind(userId),
    env.DB.prepare(`DELETE FROM artifacts WHERE ${removedArtifact("artifacts")}`).bind(userId),
    env.DB.prepare(`UPDATE artifacts SET
        source_ids = (SELECT json_group_array(src.value) FROM json_each(artifacts.source_ids) src WHERE src.value NOT IN (${soleOwnUnits})),
        source_url = (SELECT u.source_url FROM json_each(artifacts.source_ids) src JOIN ingested_units u ON u.id = src.value
          WHERE src.value IN (${otherUnits}) ORDER BY src.key LIMIT 1)
      WHERE ${touchesOwn("artifacts")}`).bind(userId),
    env.DB.prepare(`UPDATE ingested_units SET submitted_url = source_url WHERE id IN (${ownUnits})`).bind(userId),
    env.DB.prepare(`DELETE FROM artifact_exclusions WHERE unit_id IN (${soleOwnUnits})`).bind(userId),
    env.DB.prepare(`DELETE FROM ingested_units WHERE id IN (${soleOwnUnits})`).bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM x_read_requests WHERE user_key = ?1").bind(userId),
  ]);
}
