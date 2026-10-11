import {
  cookieSecure, createSession, createUser, currentUser, endSession, login, parseLogin, parseSignup, sessionCookie,
} from "./auth.js";
import { connect } from "./db.js";
import { readFeed } from "./feed.js";
import { createUnits, parseImport, readUnits, userUnitIds } from "./imports.js";
import { serveMedia } from "./media.js";
import { requestProcessing } from "./processor.js";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const UNAVAILABLE = "Resurface can't reach its database right now. Try again in a minute.";
const SIGNED_OUT = { error: "Sign in to continue." };

async function readJson(request) {
  const text = await request.text();
  if (text.length > 32_000) return { error: json({ error: "That request is too large." }, 413) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: json({ error: "Send a JSON body." }, 400) };
  }
}

async function limited(limiter, key) {
  if (!limiter) return false;
  const { success } = await limiter.limit({ key });
  return !success;
}

const ip = (request) => request.headers.get("cf-connecting-ip") ?? "local";

/** The signed-in user and how many links they've imported (0 means the home page shows its first-run state). */
async function accountState(sql, user) {
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM user_imports WHERE user_id = ${user.id}`;
  return { user: { id: user.id, email: user.email, name: user.name }, imports: count };
}

async function signup(request, env, sql) {
  if (await limited(env.AUTH_LIMITER, ip(request))) return json({ error: "Too many attempts. Wait a minute and try again." }, 429);
  const { body, error } = await readJson(request);
  if (error) return error;
  const parsed = parseSignup(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const user = await createUser(sql, parsed.value);
  if (!user) return json({ error: "There's already an account with that email. Sign in instead." }, 409);
  const token = await createSession(sql, user.id);
  return json(await accountState(sql, user), 201, { "set-cookie": sessionCookie(token, undefined, cookieSecure(request.url)) });
}

async function signin(request, env, sql) {
  if (await limited(env.AUTH_LIMITER, ip(request))) return json({ error: "Too many attempts. Wait a minute and try again." }, 429);
  const { body, error } = await readJson(request);
  if (error) return error;
  const parsed = parseLogin(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const user = await login(sql, parsed.value);
  if (!user) return json({ error: "That email and password don't match an account." }, 401);
  const token = await createSession(sql, user.id);
  return json(await accountState(sql, user), 200, { "set-cookie": sessionCookie(token, undefined, cookieSecure(request.url)) });
}

// POST /api/imports: store the links as the user's units, then hand the ones new to this user to the processor.
async function startImport(request, env, sql, user) {
  if (await limited(env.IMPORT_LIMITER, user.id)) {
    return json({ error: "That's a lot of imports at once. Wait a minute and try again." }, 429);
  }
  const { body, error } = await readJson(request);
  if (error) return error;
  const parsed = parseImport(body);
  if (!parsed.ok) {
    if (parsed.status === 202) return json({ units: [], processor: "not_needed" }, 200);
    return json({ error: parsed.error, invalid: parsed.invalid }, parsed.status);
  }
  const units = await createUnits(sql, parsed.value.links, { userId: user.id });
  const processor = await requestProcessing(env, units.filter((u) => u.linked).map((u) => u.id));
  return json({ units: await readUnits(sql, units.map((u) => u.id)), processor }, 201);
}

async function api(request, env, url, sql) {
  const { pathname } = url;
  const method = request.method;

  // Mutations must be JSON, which a cross-site form can't send; with SameSite=Lax this blocks CSRF.
  if (method !== "GET" && method !== "HEAD" && !(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return json({ error: "Send requests as application/json." }, 415);
  }

  if (pathname === "/api/auth/signup" && method === "POST") return signup(request, env, sql);
  if (pathname === "/api/auth/login" && method === "POST") return signin(request, env, sql);
  if (pathname === "/api/auth/logout" && method === "POST") {
    await endSession(sql, request);
    return json({ signedOut: true }, 200, { "set-cookie": sessionCookie("", 0, cookieSecure(request.url)) });
  }

  // The public demo feed needs no account.
  if (pathname === "/api/feed" && method === "GET" && url.searchParams.get("scope") !== "mine") {
    return json({ items: await readFeed(sql) });
  }

  const user = await currentUser(sql, request);
  // "Am I signed in?" is a normal question for every visitor, so a signed-out answer isn't an error.
  if (pathname === "/api/me" && method === "GET") {
    return json(user ? await accountState(sql, user) : { user: null });
  }
  if (!user) return json(SIGNED_OUT, 401);

  if (pathname === "/api/imports") {
    if (method === "POST") return startImport(request, env, sql, user);
    if (method === "GET") {
      return json({ units: await readUnits(sql, await userUnitIds(sql, user.id)) });
    }
  }

  if (pathname === "/api/feed" && method === "GET") {
    const ids = await userUnitIds(sql, user.id);
    return json({ items: await readFeed(sql, ids) });
  }

  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/media/")) {
      let key;
      try {
        key = decodeURIComponent(url.pathname.slice("/media/".length));
      } catch {
        return new Response("Not found.", { status: 404 });
      }
      return serveMedia(request, env, key);
    }

    if (url.pathname.startsWith("/api/")) {
      const sql = connect(env);
      if (!sql) return json({ error: UNAVAILABLE }, 503);
      try {
        return await api(request, env, url, sql);
      } catch (err) {
        console.error("api request failed", url.pathname, err);
        return json({ error: UNAVAILABLE }, 503);
      } finally {
        ctx.waitUntil(sql.end({ timeout: 5 }));
      }
    }

    return env.ASSETS.fetch(request);
  },
};
