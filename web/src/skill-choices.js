import { userUnitIds } from "./imports.js";
import { readSkills } from "./skills.js";

/** One atomic write for the reviewed revisions; never touches another account's choices. */
export async function saveSkillChoices(sql, userId, body) {
  const choices = body?.choices;
  if (!Array.isArray(choices) || !choices.length || choices.length > 1000 ||
      typeof body.generateVideos !== "boolean" || choices.some((c) => !c || typeof c.id !== "string" ||
        !Number.isInteger(c.version) || typeof c.keep !== "boolean") ||
      new Set(choices.map((c) => `${c.id}:${c.version}`)).size !== choices.length) {
    return { error: "Choose which skills to keep and try again.", status: 400 };
  }
  const owned = await readSkills(sql, await userUnitIds(sql, userId), userId, true);
  if (choices.some((c) => !owned.some((s) => s.artifact.id === c.id && s.artifact.version === c.version && s.status === "ready"))) {
    return { error: "Some skills are unavailable. Refresh and try again.", status: 409 };
  }
  await sql`INSERT INTO user_skill_choices(user_id,artifact_id,artifact_version,kept,video_requested)
    SELECT ${userId},json_extract(value,'$.id'),json_extract(value,'$.version'),json_extract(value,'$.keep'),
      CASE WHEN json_extract(value,'$.keep')=1 AND ${body.generateVideos ? 1 : 0}=1 THEN 1 ELSE 0 END
    FROM json_each(${JSON.stringify(choices)}) WHERE 1
    ON CONFLICT(user_id,artifact_id,artifact_version) DO UPDATE SET kept=excluded.kept,video_requested=excluded.video_requested`;
  return { skills: await readSkills(sql, await userUnitIds(sql, userId), userId) };
}
