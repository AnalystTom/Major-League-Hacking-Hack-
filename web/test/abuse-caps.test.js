import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import app from "../src/index.js";

function setup(vars = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const f of ["0002_application.sql", "0003_video_duration.sql", "0005_skill_choices.sql", "0007_video_limits.sql", "0008_signup_events.sql"]) {
    db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  }
  const allow = { async limit() { return { success: true }; } };
  const env = { AUTH_LIMITER: allow, IMPORT_LIMITER: allow, DB: { prepare: (q) => ({ bind: (...p) => ({ async all() { return { results: db.prepare(q).all(...p) }; } }) }) }, ...vars };
  const post = (path, body, { ip = "192.0.2.1", cookie = "" } = {}) => app.fetch(new Request(`https://resurface.test${path}`, {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip, cookie }, body: JSON.stringify(body),
  }), env, {});
  const signup = (n, ip) => post("/api/auth/signup", { email: `u${n}@example.test`, password: "correct horse battery" }, { ip });
  return { db, env, post, signup };
}
const yt = (...ids) => ({ links: ids.map((id) => `https://youtu.be/${id}`) });
const ids = ["VQy50fuxI34", "dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk", "RgKAFK5djSk", "JGwWNGJdvx8"];

test("signup is capped per IP per UTC day with a clear 429, and another IP is unaffected", async () => {
  const t = setup({ SIGNUP_IP_DAILY_LIMIT: "2" });
  assert.equal((await t.signup(1, "192.0.2.1")).status, 201);
  assert.equal((await t.signup(2, "192.0.2.1")).status, 201);
  const full = await t.signup(3, "192.0.2.1");
  assert.equal(full.status, 429);
  assert.equal((await full.json()).error, "Sign-ups are full for today. Try again tomorrow.");
  assert.ok(Number(full.headers.get("retry-after")) >= 1 && Number(full.headers.get("retry-after")) <= 86400);
  assert.equal((await t.signup(4, "192.0.2.2")).status, 201);
  // Only a hash is stored, never the address.
  const rows = t.db.prepare("SELECT ip_hash FROM signup_events").all();
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.ip_hash) && !r.ip_hash.includes("192")));
  // A new UTC day resets the count.
  t.db.exec("UPDATE signup_events SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')");
  assert.equal((await t.signup(5, "192.0.2.1")).status, 201);
});

test("signup has a global daily ceiling, and an invalid limit var fails closed", async () => {
  const t = setup({ SIGNUP_DAILY_LIMIT: "2", SIGNUP_IP_DAILY_LIMIT: "100" });
  assert.equal((await t.signup(1, "192.0.2.1")).status, 201);
  assert.equal((await t.signup(2, "192.0.2.2")).status, 201);
  assert.equal((await t.signup(3, "192.0.2.3")).status, 429);
  const bad = setup({ SIGNUP_DAILY_LIMIT: "lots" });
  assert.equal((await bad.signup(1)).status, 429);
  assert.equal(bad.db.prepare("SELECT count(*) n FROM users").get().n, 0);
});

test("default signup caps are 200 a day and 5 per IP", async () => {
  const t = setup();
  for (let i = 0; i < 5; i++) assert.equal((await t.signup(i)).status, 201);
  assert.equal((await t.signup(6)).status, 429);
});

test("SIGNUPS=off returns 503 on signup, still lets existing accounts sign in, and leaves the site public", async () => {
  const t = setup({ SIGNUP_IP_DAILY_LIMIT: "100" });
  await t.signup(1);
  t.env.SIGNUPS = "off";
  const paused = await t.signup(2);
  assert.equal(paused.status, 503);
  assert.equal((await paused.json()).error, "Sign-ups are paused.");
  assert.equal(t.db.prepare("SELECT count(*) n FROM users").get().n, 1);
  assert.equal((await t.post("/api/auth/login", { email: "u1@example.test", password: "correct horse battery" })).status, 200);
  assert.equal((await app.fetch(new Request("https://resurface.test/api/me"), t.env, {})).status, 200);
});

test("a per-account daily import cap returns 429 with Retry-After, isolates accounts and resets by UTC day", async () => {
  const t = setup({ USER_DAILY_IMPORT_LIMIT: "3", SIGNUP_IP_DAILY_LIMIT: "100" });
  const cookie = (await t.signup(1)).headers.get("set-cookie").split(";")[0];
  const other = (await t.signup(2)).headers.get("set-cookie").split(";")[0];
  assert.equal((await t.post("/api/imports", yt(ids[0], ids[1]), { cookie })).status, 201);
  const over = await t.post("/api/imports", yt(ids[2], ids[3]), { cookie });
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /1 more link/);
  assert.ok(Number(over.headers.get("retry-after")) >= 1);
  assert.equal(t.db.prepare("SELECT count(*) n FROM user_imports").get().n, 2, "rejected paste stores nothing");
  assert.equal((await t.post("/api/imports", yt(ids[2]), { cookie })).status, 201);
  const done = await t.post("/api/imports", yt(ids[3]), { cookie });
  assert.equal(done.status, 429);
  assert.match((await done.json()).error, /import limit/);
  assert.equal((await t.post("/api/imports", yt(ids[0]), { cookie: other })).status, 201);
  t.db.exec("UPDATE user_imports SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')");
  assert.equal((await t.post("/api/imports", yt(ids[4]), { cookie })).status, 201);
});

test("an invalid import limit var fails closed and the default is 5", async () => {
  const bad = setup({ USER_DAILY_IMPORT_LIMIT: "-1" });
  const cookie = (await bad.signup(1)).headers.get("set-cookie").split(";")[0];
  assert.equal((await bad.post("/api/imports", yt(ids[0]), { cookie })).status, 429);
  const t = setup();
  const c = (await t.signup(1)).headers.get("set-cookie").split(";")[0];
  assert.equal((await t.post("/api/imports", yt(...ids.slice(0, 5)), { cookie: c })).status, 201);
  assert.equal((await t.post("/api/imports", yt(ids[5]), { cookie: c })).status, 429);
});

test("a duplicate-email signup (409) does not consume the daily or per-IP cap", async () => {
  const t = setup({ SIGNUP_DAILY_LIMIT: "2", SIGNUP_IP_DAILY_LIMIT: "2" });
  assert.equal((await t.signup(1, "192.0.2.1")).status, 201);
  for (let i = 0; i < 5; i++) assert.equal((await t.signup(1, "192.0.2.1")).status, 409);
  assert.equal(t.db.prepare("SELECT count(*) n FROM signup_events").get().n, 1);
  assert.equal((await t.signup(2, "192.0.2.1")).status, 201);
  assert.equal((await t.signup(3, "192.0.2.1")).status, 429);
});
