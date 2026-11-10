import { userUnitIds } from "./imports.js";
import { readFeed } from "./feed.js";

const limits = (env) => {
  const daily = Number(env.DAILY_VIDEO_LIMIT ?? 20), monthly = Number(env.MONTHLY_VIDEO_LIMIT ?? 400);
  return { daily: Number.isSafeInteger(daily) && daily >= 0 ? daily : 0,
    monthly: Number.isSafeInteger(monthly) && monthly >= 0 ? monthly : 0 };
};

async function budget(sql, env) {
  const [used] = await sql`SELECT
    (SELECT count(*) FROM user_video_requests WHERE created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now')) AS requests_day,
    (SELECT count(*) FROM user_video_requests WHERE created_at>=strftime('%Y-%m-01T00:00:00.000Z','now')) AS requests_month,
    (SELECT count(*) FROM video_starts WHERE created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now')) AS starts_day,
    (SELECT count(*) FROM video_starts WHERE created_at>=strftime('%Y-%m-01T00:00:00.000Z','now')) AS starts_month,
    (SELECT count(*) FROM processing_starts WHERE charged=1 AND created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now')) AS processing_day,
    (SELECT count(*) FROM processing_starts WHERE charged=1 AND created_at>=strftime('%Y-%m-01T00:00:00.000Z','now')) AS processing_month,
    strftime('%Y-%m-%dT00:00:00.000Z','now','+1 day') AS tomorrow,
    strftime('%Y-%m-01T00:00:00.000Z','now','start of month','+1 month') AS next_month`;
  const { daily, monthly } = limits(env);
  return { ...used, daily, monthly };
}

function limitMessage(used, admission = true, retry = false) {
  if (!used.daily || !used.monthly) return { status: "limited", message: "Video generation is paused. Your skills are still available." };
  const month = used.starts_month >= used.monthly || (admission && used.requests_month >= used.monthly) || (retry && used.processing_month >= used.monthly);
  const day = used.starts_day >= used.daily || (admission && used.requests_day >= used.daily) || (retry && used.processing_day >= used.daily);
  if (!month && !day) return null;
  const retryAt = month ? used.next_month : used.tomorrow;
  return { status: "limited", retryAt,
    message: `The ${month ? "monthly" : "daily"} video limit has been reached. Try again after ${retryAt.slice(0, 16).replace("T", " ")} UTC.` };
}

export async function readVideoRequest(sql, userId, env = {}) {
  const [row] = await sql`SELECT r.artifact_id,r.artifact_version,c.kept,v.status,v.attempts FROM user_video_requests r
    LEFT JOIN user_skill_choices c ON c.user_id=r.user_id AND c.artifact_id=r.artifact_id AND c.artifact_version=r.artifact_version
    LEFT JOIN video_results v ON v.artifact_id=r.artifact_id AND v.artifact_version=r.artifact_version
    WHERE r.user_id=${userId}`;
  if (!row) return null;
  const result = { artifact: { id: row.artifact_id, version: row.artifact_version }, status: "queued",
    message: "Your video is queued. You can leave; processing continues." };
  const item = (await readFeed(sql, await userUnitIds(sql, userId), result.artifact)).find((v) => v.id === row.artifact_id && v.version === row.artifact_version);
  if (item) return { ...result, status: "ready", message: "You've already made your video.", url: item.video.url };
  if (row.kept === 0) return { ...result, status: "cancelled", message: "Your video is paused because its skill is no longer kept." };
  if (row.status === "running") return { ...result, status: "running", message: "Your video is being made. You can leave; processing continues." };
  if (row.status === "ready" || (row.status === "failed" && row.attempts >= 3)) return { ...result, status: "failed",
    message: "Your video couldn't be made. You can still copy or download your skills." };
  const held = limitMessage(await budget(sql, env), false, row.attempts > 0);
  if (held) return { ...result, ...held, message: held.message.replace("Try again after", "Your video will retry after") };
  if (row.status === "failed") return { ...result, status: "retrying", message: "Your video couldn't finish yet. We'll retry the same video; your skills are ready to use." };
  return result;
}

export async function reserveVideo(sql, userId, target, env = {}) {
  const { daily, monthly } = limits(env);
  // The uniqueness check and both global admission ceilings execute in one serialized D1 statement.
  await sql`INSERT INTO user_video_requests(user_id,artifact_id,artifact_version)
    SELECT ${userId},a.id,a.version FROM artifacts a WHERE a.id=${target.id} AND a.version=${target.version}
      AND json_array_length(a.source_ids)>0
      AND NOT EXISTS (SELECT 1 FROM json_each(a.source_ids) src WHERE NOT EXISTS (
        SELECT 1 FROM user_imports ui WHERE ui.user_id=${userId} AND ui.unit_id=src.value))
      AND (SELECT count(*) FROM user_video_requests WHERE created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now'))<${daily}
      AND (SELECT count(*) FROM user_video_requests WHERE created_at>=strftime('%Y-%m-01T00:00:00.000Z','now'))<${monthly}
      AND (SELECT count(*) FROM video_starts WHERE created_at>=strftime('%Y-%m-%dT00:00:00.000Z','now'))<${daily}
      AND (SELECT count(*) FROM video_starts WHERE created_at>=strftime('%Y-%m-01T00:00:00.000Z','now'))<${monthly}
    ON CONFLICT(user_id) DO NOTHING`;
  const video = await readVideoRequest(sql, userId, env);
  if (video) {
    if (video.artifact.id === target.id && video.artifact.version === target.version) return { video };
    return { error: video.status === "ready" ? "You've already made your video. Watch it below." : "You've already requested your one video. Its progress is shown below.",
      code: "video_already_requested", status: 409, video };
  }
  const held = limitMessage(await budget(sql, env));
  return { error: held?.message ?? "This skill is unavailable. Refresh and try again.", status: held ? (held.retryAt ? 429 : 503) : 409,
    code: held ? (held.retryAt ? "video_limit" : "videos_unavailable") : "skill_unavailable", retryAt: held?.retryAt };
}
