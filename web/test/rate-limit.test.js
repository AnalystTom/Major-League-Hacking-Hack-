import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/index.js";
import waitlist from "../src/waitlist.js";

const request = (path, ip = "192.0.2.1") => new Request(`https://resurface.test${path}`, {
  method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: "{}",
});
const noDatabaseAccess = { prepare() { throw new Error("must not query storage"); } };

for (const [worker, path, binding] of [
  [app, "/api/auth/signup", "AUTH_LIMITER"],
  [app, "/api/auth/login", "AUTH_LIMITER"],
  [app, "/api/waitlist", "WAITLIST_LIMITER"],
  [waitlist, "/api/waitlist", "WAITLIST_LIMITER"],
]) {
  test(`${worker === app ? "app" : "waitlist"} ${path} throttles before validation and fails closed`, async () => {
    const keys = [];
    const env = { DB: noDatabaseAccess, [binding]: { async limit({ key }) {
      keys.push(key);
      return { success: false };
    } } };
    const response = await worker.fetch(request(path), env, {});
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(keys, ["192.0.2.1"]);
    for (const limiter of [undefined, {}, { async limit() { throw new Error("outage"); } }, { async limit() { return {}; } }]) {
      env[binding] = limiter;
      const unavailable = await worker.fetch(request(path), env, {});
      assert.equal(unavailable.status, 503);
      assert.match((await unavailable.json()).error, /Abuse protection/);
    }
  });
}

test("signup and login share an IP window without blocking another IP", async () => {
  const counts = new Map();
  const env = { DB: noDatabaseAccess, AUTH_LIMITER: { async limit({ key }) {
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return { success: count <= 10 };
  } } };
  for (let i = 0; i < 10; i++) {
    const path = i % 2 ? "/api/auth/signup" : "/api/auth/login";
    assert.equal((await app.fetch(request(path), env, {})).status, 400);
  }
  assert.equal((await app.fetch(request("/api/auth/login"), env, {})).status, 429);
  assert.equal((await app.fetch(request("/api/auth/signup", "192.0.2.2"), env, {})).status, 400);
});

for (const worker of [app, waitlist]) {
  test(`${worker === app ? "app" : "waitlist"} waitlist writes only within its IP limit`, async () => {
    let writes = 0;
    let now = 0;
    const windows = new Map();
    const env = {
      WAITLIST_LIMITER: { async limit({ key }) {
        const window = Math.floor(now / 60);
        const entry = windows.get(key);
        const count = entry?.window === window ? entry.count + 1 : 1;
        windows.set(key, { window, count });
        return { success: count <= 10 };
      } },
      DB: { prepare() { return { bind() { return { async run() {
        writes++;
        return { meta: { changes: 1 } };
      } }; } }; } },
    };
    const join = (ip = "192.0.2.1") => worker.fetch(new Request("https://resurface.test/api/waitlist", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ email: "test@example.com" }),
    }), env, {});
    const responses = await Promise.all(Array.from({ length: 12 }, () => join()));
    assert.equal(responses.filter(r => r.status === 200).length, 10);
    assert.equal(responses.filter(r => r.status === 429).length, 2);
    assert.equal(writes, 10);
    assert.equal((await join("192.0.2.2")).status, 200);
    now = 60;
    assert.equal((await join()).status, 200);
    assert.equal(writes, 12);
  });
}
