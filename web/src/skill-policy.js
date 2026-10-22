export const SKILL_PROMPT_REVISION = "skill-v4-skill-creator";

export function skillStatus(status, feedback) {
  let review;
  try { review = JSON.parse(feedback); } catch {}
  return (status === "ready" && review?.prompt_revision !== SKILL_PROMPT_REVISION) || review?.regenerating ? "regenerating" : status;
}
