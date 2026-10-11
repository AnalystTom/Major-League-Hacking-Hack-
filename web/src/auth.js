// Accounts: email + password in TigerData, PBKDF2-SHA256 via Web Crypto, and an httpOnly session
// cookie whose token is stored only as a SHA-256 hash. Pure helpers are unit tested with node --test.

// workerd caps PBKDF2 at 100,000 iterations.
const ITERATIONS = 100_000;
const SESSION_DAYS = 30;
export const COOKIE = "rs_session";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored).split("$");
  if (scheme !== "pbkdf2-sha256" || !salt || !hash) return false;
  const actual = new Uint8Array(await derive(password, unb64(salt), Number(iter)));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

const sha256 = async (s) => b64(await crypto.subtle.digest("SHA-256", enc.encode(s)));

export function parseSignup(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "Send your email and a password." };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, error: "Enter an email address like you@example.com." };
  if (password.length < 10) return { ok: false, error: "Use a password of at least 10 characters." };
  if (password.length > 200) return { ok: false, error: "That password is too long." };
  return { ok: true, value: { email, password, name: name || null } };
}

export function parseLogin(body) {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password || password.length > 200) return { ok: false, error: "Enter your email and password." };
  return { ok: true, value: { email, password } };
}

/** Value of one cookie from a Cookie header, or null. */
export function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

// Secure unless the request is to this machine: fails closed, so a deployment reached over plain
// http still never sends the token unencrypted. Local dev needs it off or Safari drops the cookie.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const cookieSecure = (url) => !LOCAL_HOSTS.has(new URL(url).hostname);

export const sessionCookie = (token, maxAge = SESSION_DAYS * 86400, secure = true) =>
  `${COOKIE}=${token}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax; Max-Age=${maxAge}`;

export async function createSession(sql, userId) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${await sha256(token)}, ${userId}, now() + make_interval(days => ${SESSION_DAYS}))`;
  return token;
}

/** The signed-in user for this request, or null. */
export async function currentUser(sql, request) {
  const token = readCookie(request.headers.get("cookie"), COOKIE);
  if (!token) return null;
  const [user] = await sql`
    SELECT u.id, u.email, u.name, u.project_context_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${await sha256(token)} AND s.expires_at > now()`;
  return user ?? null;
}

export async function endSession(sql, request) {
  const token = readCookie(request.headers.get("cookie"), COOKIE);
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${await sha256(token)}`;
}

/** Creates the account, or returns null when the email is taken. */
export async function createUser(sql, { email, password, name }) {
  const [user] = await sql`
    INSERT INTO users (email, name, password_hash)
    VALUES (${email}, ${name}, ${await hashPassword(password)})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email, name, project_context_id`;
  return user ?? null;
}

// Verifies against a real hash even for unknown emails, so response time doesn't reveal accounts.
const DUMMY = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function login(sql, { email, password }) {
  const [row] = await sql`SELECT id, email, name, project_context_id, password_hash FROM users WHERE email = ${email}`;
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY);
  if (!row || !ok) return null;
  const { password_hash, ...user } = row;
  return user;
}
