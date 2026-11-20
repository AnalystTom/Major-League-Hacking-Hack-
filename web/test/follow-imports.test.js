import test from "node:test";
import assert from "node:assert/strict";
import { followImports } from "../public/units.js";

const BODIES = {
  "/api/imports": { units: [] },
  "/api/feed?scope=mine": { items: [] },
  "/api/skills": { skills: [] },
};

function fakeServer() {
  const calls = [];
  const fetch = (path, { signal }) => {
    calls.push(path);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify(BODIES[path]), { status: 200 })), 5);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  };
  return { calls, fetch };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

test("stopping the follower cancels the in-flight poll and sends nothing more", async (t) => {
  const server = fakeServer();
  t.mock.method(globalThis, "fetch", server.fetch);
  const seen = [];
  const follower = followImports({
    onUnits: () => seen.push("units"),
    onItems: () => seen.push("items"),
    onSkills: () => seen.push("skills"),
    onError: (err) => seen.push(`error ${err.name}`),
  });
  follower.stop();
  await settle();
  assert.deepEqual(server.calls, ["/api/imports"]);
  assert.deepEqual(seen, []);
});

test("a resumed follower polls the whole chain again", async (t) => {
  const server = fakeServer();
  t.mock.method(globalThis, "fetch", server.fetch);
  const seen = [];
  const follower = followImports({
    onUnits: () => seen.push("units"),
    onItems: () => seen.push("items"),
    onSkills: () => seen.push("skills"),
  });
  follower.stop();
  await follower.resume();
  assert.deepEqual(server.calls, ["/api/imports", "/api/imports", "/api/feed?scope=mine", "/api/skills"]);
  assert.deepEqual(seen, ["units", "items", "skills"]);
});
