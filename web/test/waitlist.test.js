import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/waitlist.js";

const request = (body, headers = { "content-type": "application/json" }) =>
  new Request("https://resurface.test/api/waitlist", { method: "POST", headers, body });

test("rejects invalid, oversized, and non-JSON submissions before writing", async () => {
  for (const [req, status] of [
    [new Request("https://resurface.test/api/waitlist"), 405],
    [request("not json"), 400],
    [request('null'), 400],
    [request('{"email":"invalid"}'), 400],
    [request('x'.repeat(32_001)), 413],
    [request('{"email":"a@b.co"}', { "content-type": "text/plain" }), 415],
  ]) {
    assert.equal((await worker.fetch(req, {})).status, status);
  }
});

test("bots don't write to storage and storage failure never reports success", async () => {
  const ignored = await worker.fetch(request('{"email":"a@b.co","company":"spam"}'), {});
  assert.equal(ignored.status, 200);
  assert.deepEqual(await ignored.json(), { joined: true });
  const unavailable = await worker.fetch(request('{"email":"a@b.co"}'), {});
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).joined, undefined);
});

test("waitlist deployment redirects onboarding and declines product APIs", async () => {
  for (const path of ["/start", "/start.html", "/start/", "/app", "/app.html"]) {
    const response = await worker.fetch(new Request(`https://resurface.test${path}`), {});
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://resurface.test/#join");
  }
  assert.equal((await worker.fetch(new Request("https://resurface.test/api/auth/signup"), {})).status, 503);
});
