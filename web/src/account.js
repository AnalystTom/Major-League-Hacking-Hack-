import { isObjectKey } from "./media.js";

const otherImporter = `EXISTS (SELECT 1 FROM user_imports other WHERE other.unit_id = mine.unit_id AND other.user_id <> ?1)`;
const soleUnits = `SELECT mine.unit_id FROM user_imports mine WHERE mine.user_id = ?1 AND NOT ${otherImporter}`;
const sharedUnits = `SELECT mine.unit_id FROM user_imports mine WHERE mine.user_id = ?1 AND ${otherImporter}`;
const soleSourced = (artifact) => `EXISTS (SELECT 1 FROM json_each(${artifact}.source_ids) src WHERE src.value IN (${soleUnits}))`;
const doomedArtifact = (artifact) => `NOT EXISTS (SELECT 1 FROM json_each(${artifact}.source_ids) src WHERE src.value NOT IN (${soleUnits}))`;
const keptMixedArtifact = (artifact) => `${soleSourced(artifact)} AND NOT ${doomedArtifact(artifact)}`;
const doomedChild = (table) => `EXISTS (SELECT 1 FROM artifacts a
  WHERE a.id = ${table}.artifact_id AND a.version = ${table}.artifact_version AND ${doomedArtifact("a")})`;
const doomedSkill = `SELECT s.id FROM skill_results s JOIN artifacts a ON a.id = s.artifact_id AND a.version = s.artifact_version
  WHERE ${doomedArtifact("a")}`;
const removedVideo = `${doomedChild("video_results")} OR video_results.id IN (SELECT value FROM json_each(?2))`;

export async function deleteAccount(env, userId) {
  const { results: videoRows } = await env.DB.prepare(`
    SELECT v.id, v.media_ref, v.caption_ref, v.narration_ref, v.music_ref FROM video_results v
    JOIN artifacts a ON a.id = v.artifact_id AND a.version = v.artifact_version
    WHERE ${doomedArtifact("a")}`).bind(userId).all();
  const mediaKeys = [...new Set(videoRows.flatMap(({ id, ...refs }) => Object.values(refs))
    .filter((ref) => typeof ref === "string" && ref.startsWith("r2:"))
    .map((ref) => ref.slice(3))
    .filter(isObjectKey))];
  await Promise.all(mediaKeys.map((key) => env.MEDIA.delete(key)));
  const removedVideoIds = JSON.stringify(videoRows.map((row) => row.id));

  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
    env.DB.prepare(`DELETE FROM handoffs WHERE skill_result_id IN (${doomedSkill})`).bind(userId),
    env.DB.prepare(`DELETE FROM skill_results WHERE ${doomedChild("skill_results")}`).bind(userId),
    env.DB.prepare(`DELETE FROM video_results WHERE ${removedVideo}`).bind(userId, removedVideoIds),
    env.DB.prepare(`UPDATE video_starts SET artifact_id = NULL, artifact_version = NULL WHERE ${doomedChild("video_starts")}`).bind(userId),
    env.DB.prepare(`DELETE FROM user_skill_choices WHERE user_id = ?1 OR ${doomedChild("user_skill_choices")}`).bind(userId),
    env.DB.prepare("UPDATE user_video_requests SET user_id = NULL, artifact_id = NULL, artifact_version = NULL WHERE user_id = ?1").bind(userId),
    env.DB.prepare(`DELETE FROM user_video_requests WHERE ${doomedChild("user_video_requests")}`).bind(userId),
    env.DB.prepare(`DELETE FROM video_rejection_releases WHERE user_id = ?1 OR ${doomedChild("video_rejection_releases")}`).bind(userId),
    env.DB.prepare(`UPDATE artifacts SET
      source_ids = (SELECT json_group_array(kept.value) FROM (SELECT src.value FROM json_each(artifacts.source_ids) src WHERE src.value NOT IN (${soleUnits}) ORDER BY src.key) kept),
      sources = (SELECT json_group_array(json(kept.value)) FROM (SELECT s.value, s.key FROM json_each(artifacts.sources) s ORDER BY s.key) kept
        WHERE json_extract(artifacts.source_ids, '$[' || kept.key || ']') NOT IN (${soleUnits})),
      source_url = (SELECT u.source_url FROM json_each(artifacts.source_ids) src JOIN ingested_units u ON u.id = src.value WHERE src.value NOT IN (${soleUnits}) ORDER BY src.key LIMIT 1)
      WHERE ${keptMixedArtifact("artifacts")}`).bind(userId),
    env.DB.prepare(`DELETE FROM artifacts WHERE ${doomedArtifact("artifacts")}`).bind(userId),
    env.DB.prepare(`DELETE FROM artifact_exclusions WHERE unit_id IN (${soleUnits})`).bind(userId),
    env.DB.prepare(`UPDATE processing_starts SET unit_id = NULL WHERE charged = 1 AND unit_id IN (${soleUnits})`).bind(userId),
    env.DB.prepare(`UPDATE ingested_units SET submitted_url = source_url WHERE id IN (${sharedUnits})`).bind(userId),
    env.DB.prepare(`DELETE FROM ingested_units WHERE id IN (${soleUnits})`).bind(userId),
    env.DB.prepare("DELETE FROM user_imports WHERE user_id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(userId),
    env.DB.prepare("UPDATE x_read_requests SET user_key = NULL WHERE user_key = ?1").bind(userId),
  ]);
}
