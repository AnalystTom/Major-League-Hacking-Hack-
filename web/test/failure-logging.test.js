import { test } from "node:test";
import assert from "node:assert/strict";
import app from "../src/index.js";
import waitlist from "../src/waitlist.js";
import { requestProcessing, requestVideoProcessing } from "../src/processor.js";
import { logFailure } from "../src/log.js";

const ID = "11111111-1111-4111-8111-111111111111";
const PROCESSOR = { PROCESSOR_URL: "https://p.dev/process", PROCESSOR_TOKEN: "processor-secret" };
const lines = (logged) => logged.mock.calls.map((call) => call.arguments);

test("processor hand-off logs the HTTP status of a non-2xx answer and the message of a thrown call", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  assert.equal(await requestProcessing(PROCESSOR, [ID], async () => new Response("", { status: 503 })), "unavailable");
  assert.equal(await requestProcessing(PROCESSOR, [ID], async () => { throw new Error("connect refused"); }), "unavailable");
  assert.equal(await requestVideoProcessing(PROCESSOR, async () => new Response("", { status: 401 })), "unavailable");
  assert.equal(await requestVideoProcessing(PROCESSOR, async () => { throw new Error("timed out"); }), "unavailable");
  assert.equal(await requestProcessing(PROCESSOR, [ID], async () => new Response("", { status: 202 })), "requested");
  assert.deepEqual(lines(logged), [
    ["processor request failed", "HTTP 503"],
    ["processor request failed", "connect refused"],
    ["processor video wake failed", "HTTP 401"],
    ["processor video wake failed", "timed out"],
  ]);
  assert.ok(!JSON.stringify(lines(logged)).includes("processor-secret"));
});

test("a media read that fails in storage logs one line and still answers 503", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const env = { DB: { prepare() { throw new Error("D1_ERROR: storage offline"); } } };
  const response = await app.fetch(new Request(`http://localhost/media/videos/${ID}/1/short.mp4`), env, {});
  assert.equal(response.status, 503);
  assert.deepEqual(lines(logged), [["media request failed", "D1_ERROR: storage offline"]]);
});

test("a parse error logs its name only so a token fragment in the body never reaches the log", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  logFailure("token exchange failed", new SyntaxError('Unexpected token in JSON at position 5: {"access_token":"fixture-leak-token"'));
  assert.deepEqual(lines(logged), [["token exchange failed", "SyntaxError"]]);
  assert.ok(!JSON.stringify(lines(logged)).includes("fixture-leak-token"));
});

test("a failed waitlist insert logs the storage error but not the submitted email", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const env = {
    WAITLIST_LIMITER: { async limit() { return { success: true }; } },
    DB: { prepare() { throw new Error("D1_ERROR: no such table: waitlist"); } },
  };
  const response = await waitlist.fetch(new Request("https://resurface.test/api/waitlist", {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"email":"private@example.com"}',
  }), env);
  assert.equal(response.status, 503);
  assert.deepEqual(lines(logged), [["waitlist insert failed", "D1_ERROR: no such table: waitlist"]]);
});
