import { isMediaKey } from "./media.js";

const ownedUnits = "SELECT unit_id FROM user_imports WHERE user_id = ?1";
const ownedArtifact = (artifact) => `EXISTS (SELECT 1 FROM json_each(${artifact}.source_ids) src WHERE src.value IN (${ownedUnits}))`;
const ownedChild = (table) => `EXISTS (SELECT 1 FROM artifacts a
  WHERE a.id = ${table}.artifact_id AND a.version = ${table}.artifact_version AND ${ownedArtifact("a")})`;

export async function deleteAccount(env, userId) {
  const { results: mediaRows } = await env.DB.prepare(`
    SELECT v.media_ref, v.caption_ref, v.narration_ref, v.music_ref FROM video_results v
    JOIN artifacts a ON a.id = v.artifact_id AND a.version = v.artifact_version
    WHERE ${ownedArtifact("a")}`).bind(userId).all();
  const mediaKeys = [...new Set(mediaRows.flatMap((row) => Object.values(row))
    .filter((ref) => typeof ref === "string" && ref.startsWith("r2:"))
    .map((ref) => ref.slice(3))
    .filter(isMediaKey))];
  await Promise.all(mediaKeys.map((key) => env.MEDIA.delete(key)));

  await env.DB.batch([
    env.DB.prepare("PRAGMA defer_foreign_keys = ON"),
    env.DB.prepare(`DELETE FROM agent_briefs WHERE EXISTS (SELECT 1 FROM json_each(agent_briefs.skill_result_ids) ref
      WHERE ref.value IN (SELECT s.id FROM skill_results s JOIN artifacts a ON a.id = s.artifact_id AND a.version = s.artifact_version
        WHERE ${ownedArtifact("a")}))`).bind(userId),
    env.DB.prepare(`
      DELETE FROM handoffs WHERE EXISTS (SELECT 1 FROM skill_results s JOIN artifacts a ON a.id = s.artifact_id AND a.version = s.artifact_version
        WHERE s.id = handoffs.skill_result_id AND ${ownedArtifact("a")})`).bind(userId),
    env.DB.prepare(`DELETE FROM skill_results WHERE ${ownedChild("skill_results")}`).bind(userId),
    env.DB.prepare(`DELETE FROM video_results WHERE ${ownedChild("video_results")}`).bind(userId),
    env.DB.prepare(`DELETE FROM video_starts WHERE ${ownedChild("video_starts")}`).bind(userId),
    env.DB.prepare(`DELETE FROM user_skill_choices WHERE ${ownedChild("user_skill_choices")}`).bind(userId),
    env.DB.prepare(`DELETE FROM user_video_requests WHERE ${ownedChild("user_video_requests")}`).bind(userId),
    env.DB.prepare(`DELETE FROM artifacts WHERE ${ownedArtifact("artifacts")}`).bind(userId),
    env.DB.prepare(`DELETE FROM artifact_exclusions WHERE unit_id IN (${ownedUnits})`).bind(userId),
    env.DB.prepare(`DELETE FROM user_imports WHERE user_id <> ?1 AND unit_id IN (${ownedUnits})`).bind(userId),
    env.DB.prepare(`DELETE FROM ingested_units WHERE id IN (${ownedUnits})`).bind(userId),
    env.DB.prepare("DELETE FROM user_imports WHERE user_id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM x_read_requests WHERE user_key = ?1").bind(userId),
  ]);
}
