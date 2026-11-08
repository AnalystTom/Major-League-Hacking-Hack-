// X credentials and encrypted user tokens stay on the Worker. No email-based account merging.
import { cookieSecure, createSession, readCookie, sessionCookie } from './auth.js';
import { createUnits, parseImport, readUnits, userUnitIds } from './imports.js';
import { requestProcessing } from './processor.js';

const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c]);
const hash = async value => b64(await crypto.subtle.digest('SHA-256', enc.encode(value)));
const now = () => Math.floor(Date.now() / 1000);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const redirect = (path, cookies = []) => new Response(null, { status: 303, headers: [['location', path], ['cache-control', 'no-store'], ['referrer-policy', 'no-referrer'], ...cookies.map(c => ['set-cookie', c])] });
const nonceCookie = (value, request, age = 600) => `rs_x_nonce=${value}; Path=/api/auth/x; HttpOnly; SameSite=Lax; Max-Age=${age}${cookieSecure(request.url) ? '; Secure' : ''}`;
const callbackUrl = env => env.X_CALLBACK_URL;
const SCOPES = 'tweet.read users.read bookmark.read';
const MAX_BOOKMARKS = 100;

export function xAvailable(env) {
  try {
    const url = new URL(callbackUrl(env));
    return Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET && env.X_READS_ENABLED === 'true' && url.pathname === '/api/auth/x/callback' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))));
  } catch { return false; }
}

// The optional service binding lets isolated tests use a local provider without paid requests.
async function provider(env, path, options = {}) {
  const send = env.X_PROVIDER ? env.X_PROVIDER.fetch.bind(env.X_PROVIDER) : fetch;
  return send(`https://api.x.com${path}`, { ...options, signal: AbortSignal.timeout(8000), redirect: 'manual' });
}

async function cryptKey(env) {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode(`resurface-x-v1:${env.X_CLIENT_SECRET}`)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return `${b64(iv)}.${b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptKey(env), enc.encode(token)))}`;
}
async function unseal(env, value) {
  const [iv, data] = value.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, await cryptKey(env), bytes(data)));
}
const clientAuth = env => `Basic ${btoa(`${encodeURIComponent(env.X_CLIENT_ID)}:${encodeURIComponent(env.X_CLIENT_SECRET)}`)}`;

async function start(request, env, sql, user) {
  if (!xAvailable(env)) return redirect('/start?x=unavailable');
  if (env.AUTH_LIMITER && !(await env.AUTH_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'local' })).success) return json({ error: 'Too many sign-in attempts. Try again in a minute.' }, 429);
  await sql`DELETE FROM x_oauth_attempts WHERE expires_at < ${now()}`;
  const state = random(), browser = random(), verifier = random();
  await sql`INSERT INTO x_oauth_attempts(state_hash,browser_hash,verifier,user_id,expires_at)
    VALUES(${await hash(state)},${await hash(browser)},${verifier},${user?.id ?? null},${now() + 600})`;
  let target = 'https://x.com/i/oauth2/authorize';
  // Only loopback verification may substitute a local authorization screen. Never honored on a public host.
  if (['localhost', '127.0.0.1'].includes(new URL(request.url).hostname) && env.X_TEST_AUTHORIZE_URL) {
    const local = new URL(env.X_TEST_AUTHORIZE_URL);
    if (local.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(local.hostname)) target = local.href;
  }
  const url = new URL(target);
  const challenge = (await hash(verifier)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' })[c]);
  url.search = new URLSearchParams({ response_type: 'code', client_id: env.X_CLIENT_ID, redirect_uri: callbackUrl(env), scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' });
  return redirect(url.href, [nonceCookie(browser, request)]);
}

async function callback(request, env, sql, user) {
  const clear = nonceCookie('', request, 0);
  if (!xAvailable(env)) return redirect('/start?x=unavailable', [clear]);
  const url = new URL(request.url), state = url.searchParams.get('state');
  const browser = readCookie(request.headers.get('cookie'), 'rs_x_nonce');
  if (!state || state.length > 200 || !browser) return redirect('/start?x=invalid', [clear]);
  // Consume once, and only from the browser that began the flow (a mismatch cannot burn another flow).
  const [attempt] = await sql`DELETE FROM x_oauth_attempts WHERE state_hash=${await hash(state)} AND browser_hash=${await hash(browser)} RETURNING *`;
  if (!attempt || attempt.expires_at < now() || (attempt.user_id ?? null) !== (user?.id ?? null)) return redirect('/start?x=invalid', [clear]);
  if (url.searchParams.has('error')) return redirect('/start?x=denied', [clear]);
  const code = url.searchParams.get('code');
  if (!code || code.length > 2000) return redirect('/start?x=invalid', [clear]);
  try {
    const tokenResponse = await provider(env, '/2/oauth2/token', { method: 'POST', headers: { authorization: clientAuth(env), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(env), code_verifier: attempt.verifier }).toString() });
    if (!tokenResponse.ok) return redirect('/start?x=failed', [clear]);
    const token = await tokenResponse.json();
    if (typeof token.access_token !== 'string' || token.access_token.length > 8000 || !Number.isFinite(token.expires_in) || token.expires_in <= 0 ||
        !SCOPES.split(' ').every(s => String(token.scope ?? '').split(' ').includes(s))) return redirect('/start?x=failed', [clear]);
    const identityResponse = await provider(env, '/2/users/me', { headers: { authorization: `Bearer ${token.access_token}` } });
    if (!identityResponse.ok) return redirect('/start?x=failed', [clear]);
    const { data } = await identityResponse.json();
    if (!/^\d{1,19}$/.test(data?.id) || !/^[A-Za-z0-9_]{1,15}$/.test(data?.username)) return redirect('/start?x=failed', [clear]);
    const [linked] = await sql`SELECT user_id FROM x_connections WHERE x_user_id=${data.id}`;
    if (user && linked && linked.user_id !== user.id) return redirect('/app?x=conflict', [clear]);
    let userId = user?.id ?? linked?.user_id;
    if (!userId) {
      // Internal namespace cannot collide with valid signup emails. Never displayed as an email.
      const [created] = await sql`INSERT INTO users(email,name,password_hash) VALUES(${'oauth:x:' + data.id},${String(data.name ?? data.username).slice(0,80)},'')
        ON CONFLICT(email) DO UPDATE SET name=excluded.name RETURNING id`;
      userId = created.id;
    }
    const encrypted = await seal(env, token.access_token);
    await sql`INSERT INTO x_connections(x_user_id,user_id,username,access_token,expires_at) VALUES(${data.id},${userId},${data.username},${encrypted},${now() + Math.min(token.expires_in, 86400)})
      ON CONFLICT(x_user_id) DO UPDATE SET username=excluded.username,access_token=excluded.access_token,expires_at=excluded.expires_at,cursor=NULL,read_count=0,import_state='pending',error=NULL,lease_until=0
      WHERE x_connections.user_id=excluded.user_id`;
    const session = await createSession(sql, userId);
    return redirect('/app?import=x', [clear, sessionCookie(session, undefined, cookieSecure(request.url))]);
  } catch {
    return redirect('/start?x=failed', [clear]);
  }
}

async function status(env, sql, user) {
  const [row] = user ? await sql`SELECT username,expires_at,import_state,read_count,error,access_token IS NOT NULL AS connected FROM x_connections WHERE user_id=${user.id}` : [];
  return json({ available: xAvailable(env), connected: Boolean(row?.connected), ...(row ? { username: row.username, expired: row.expires_at <= now(), state: row.import_state, read: row.read_count, error: row.error } : {}) });
}

async function importBookmarks(env, sql, user, request) {
  if (!xAvailable(env)) return json({ error: 'X bookmark import is unavailable. Paste links instead.' }, 503);
  if (env.IMPORT_LIMITER && !(await env.IMPORT_LIMITER.limit({ key: user.id })).success) return json({ error: 'Too many imports. Try again in a minute.' }, 429);
  const lease = random();
  const [row] = await sql`UPDATE x_connections SET lease_until=${now() + 45},lease_token=${lease} WHERE user_id=${user.id} AND access_token IS NOT NULL AND expires_at>${now()} AND lease_until<=${now()} RETURNING *`;
  if (!row) return json({ error: 'X is disconnected, expired, or already importing. Reconnect or try again shortly.' }, 409);
  try {
    const remaining = MAX_BOOKMARKS - row.read_count;
    if (row.import_state === 'complete' || remaining <= 0) return json({ complete: true, read: row.read_count });
    const params = new URLSearchParams({ max_results: String(remaining), 'tweet.fields': 'author_id,created_at' });
    if (row.cursor) params.set('pagination_token', row.cursor);
    const response = await provider(env, `/2/users/${row.x_user_id}/bookmarks?${params}`, { headers: { authorization: `Bearer ${await unseal(env, row.access_token)}` } });
    if (!response.ok) {
      const message = response.status === 429 ? 'X has reached its read limit. Try importing again later.' : response.status === 401 ? 'Your X connection expired. Reconnect to continue.' : 'X bookmarks could not be read. Paste links or try again later.';
      await sql`UPDATE x_connections SET import_state='failed',error=${message} WHERE user_id=${user.id} AND lease_token=${lease}`;
      return json({ error: message }, response.status === 429 ? 429 : 502);
    }
    const page = await response.json();
    if (!Number.isInteger(page.meta?.result_count) || page.meta.result_count !== (page.data ?? []).length || (page.data !== undefined && !Array.isArray(page.data)) || (page.data ?? []).length > remaining ||
        !(page.data ?? []).every(p => typeof p.id === 'string' && /^\d{1,19}$/.test(p.id)) || page.errors?.length) throw new Error('Invalid bookmarks response');
    const posts = page.data ?? [];
    const next = page.meta?.next_token;
    if (next !== undefined && (typeof next !== 'string' || next.length > 2000 || next === row.cursor || !posts.length)) throw new Error('Invalid pagination');
    const parsed = posts.length ? parseImport({ links: posts.map(p => `https://x.com/i/status/${p.id}`) }) : null;
    if (parsed && !parsed.ok) throw new Error('Invalid bookmark links');
    const [stillConnected] = await sql`SELECT x_user_id FROM x_connections WHERE user_id=${user.id} AND x_user_id=${row.x_user_id} AND access_token IS NOT NULL AND lease_token=${lease}`;
    if (!stillConnected) return json({ error: 'X was disconnected.' }, 409);
    const units = parsed ? await createUnits(sql, parsed.value.links, { userId: user.id }) : [];
    const processor = await requestProcessing(env, units.filter(u => u.linked).map(u => u.id));
    const count = row.read_count + posts.length;
    const complete = !next || count >= MAX_BOOKMARKS;
    await sql`UPDATE x_connections SET cursor=${complete ? null : next},read_count=${count},import_state=${complete ? 'complete' : 'pending'},error=NULL WHERE user_id=${user.id} AND lease_token=${lease}`;
    return json({ complete, read: count, capped: Boolean(next && complete), processor, units: await readUnits(sql, units.map(u => u.id), await userUnitIds(sql, user.id)) });
  } catch {
    const message = 'X bookmarks could not be imported. Your saved links are safe; try again later.';
    await sql`UPDATE x_connections SET import_state='failed',error=${message} WHERE user_id=${user.id} AND lease_token=${lease}`;
    return json({ error: message }, 502);
  } finally {
    await sql`UPDATE x_connections SET lease_until=0,lease_token=NULL WHERE user_id=${user.id} AND lease_token=${lease}`;
  }
}

export async function xRoute(request, env, sql, user) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/auth/x/start' && request.method === 'GET') return start(request, env, sql, user);
  if (path === '/api/auth/x/callback' && request.method === 'GET') return callback(request, env, sql, user);
  if (path === '/api/x' && request.method === 'GET') return status(env, sql, user);
  if (!path.startsWith('/api/x')) return null;
  if (!user) return json({ error: 'Sign in to continue.' }, 401);
  if (path === '/api/x/bookmarks' && request.method === 'POST') return importBookmarks(env, sql, user, request);
  if (path === '/api/x/disconnect' && request.method === 'POST') {
    const [row] = await sql`SELECT access_token FROM x_connections WHERE user_id=${user.id}`;
    await sql`UPDATE x_connections SET access_token=NULL,expires_at=0,cursor=NULL,import_state='disconnected',error=NULL WHERE user_id=${user.id}`;
    if (row?.access_token && xAvailable(env)) {
      try { await provider(env, '/2/oauth2/revoke', { method: 'POST', headers: { authorization: clientAuth(env), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: await unseal(env, row.access_token), token_type_hint: 'access_token' }).toString() }); } catch {}
    }
    return json({ disconnected: true });
  }
  return json({ error: 'Not found.' }, 404);
}
