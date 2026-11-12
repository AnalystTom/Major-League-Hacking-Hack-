// Daily abuse caps, all configured by Worker vars. A day is a UTC day.

/** Non-negative integer from a var; unset uses the default, anything invalid is 0 so the cap fails closed. */
export const limitVar = (value, fallback) =>
  value === undefined ? fallback : /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : 0;

export const utcDay = () => new Date().toISOString().slice(0, 10);

const untilTomorrow = () => String(Math.max(1, Math.ceil((Date.parse(`${utcDay()}T00:00:00Z`) + 86_400_000 - Date.now()) / 1000)));

export const limited = (error, headers = {}) =>
  Response.json({ error }, { status: 429, headers: { "retry-after": untilTomorrow(), "cache-control": "no-store", ...headers } });

const sha256 = async (text) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A 503 when sign-ups are switched off with SIGNUPS=off, else null. */
export const signupsPaused = (env) =>
  env.SIGNUPS === "off" ? Response.json({ error: "Sign-ups are paused." }, { status: 503, headers: { "cache-control": "no-store" } }) : null;

/**
 * Reserves one new-account slot (global and per-IP, per UTC day) with a single conditional insert.
 * Returns { id } when reserved, else { full } with the 429 to send. Rows older than two days are dropped.
 */
export async function reserveSignup(env, sql, ip) {
  const day = utcDay();
  const global = limitVar(env.SIGNUP_DAILY_LIMIT, 200);
  const perIp = limitVar(env.SIGNUP_IP_DAILY_LIMIT, 5);
  const ipHash = await sha256(`resurface-signup-v1:${ip}`);
  await sql`DELETE FROM signup_events WHERE created_at < date(${day}, '-1 day')`;
  const reserved = await sql`INSERT INTO signup_events(ip_hash) SELECT ${ipHash}
    WHERE (SELECT count(*) FROM signup_events WHERE created_at >= ${day}) < ${global}
    AND (SELECT count(*) FROM signup_events WHERE ip_hash = ${ipHash} AND created_at >= ${day}) < ${perIp} RETURNING id`;
  return reserved.length ? { id: reserved[0].id } : { full: limited("Sign-ups are full for today. Try again tomorrow.") };
}

/** Gives a reserved slot back when no new account was created. */
export const refundSignup = (sql, id) => sql`DELETE FROM signup_events WHERE id = ${id}`;

// shortcut: check-then-write, so parallel pastes can overshoot by at most one paste per IMPORT_LIMITER window; make it a conditional insert if that matters.
/** Links this account may still import today (UTC), counted from user_imports. */
export async function importsLeft(env, sql, userId) {
  const limit = limitVar(env.USER_DAILY_IMPORT_LIMIT, 5);
  const [{ used }] = await sql`SELECT count(*) AS used FROM user_imports WHERE user_id = ${userId} AND created_at >= ${utcDay()}`;
  return Math.max(0, limit - used);
}

/** The 429 for an account that has `left` imports left today, or null when `incoming` fit. */
export const importCapResponse = (left, incoming) => incoming <= left ? null
  : limited(left ? `You can add ${left} more ${left === 1 ? "link" : "links"} today. Try fewer links or come back tomorrow.` : "You've reached today's import limit. Try again tomorrow.");

export async function checkImportCap(env, sql, userId, incoming) {
  return importCapResponse(await importsLeft(env, sql, userId), incoming);
}
