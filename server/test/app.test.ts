import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";

const app = createApp({ webOrigins: ["https://site.example"] });

test("health check", async () => {
  const res = await app.request("/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, busy: 0 }, "no last_error without the processor token");
});

test("lists the sample shorts", async () => {
  const shorts = await (await app.request("/api/shorts")).json();
  assert.equal(shorts.length, 5);
});

test("exports a skill short as a SKILL.md for Claude Code", async () => {
  const body = await (await app.request("/api/shorts/grill/export?agent=claude")).json();
  assert.equal(body.path, ".claude/skills/grill-me/SKILL.md");
  assert.match(body.content, /^---\nname: grill-me\ndescription: Make your agent interview you before it plans\.\n---/);
  assert.match(body.content, /https:\/\/github\.com\/mattpocock\/skills/);
});

test("exports a rules short as an AGENTS.md section for Codex", async () => {
  const body = await (await app.request("/api/shorts/judgment/export?agent=codex")).json();
  assert.equal(body.path, "AGENTS.md");
  assert.match(body.content, /^## Write down the correction you keep repeating\./);
});

test("Hermes has no rules file, so rules shorts become skills", async () => {
  const body = await (await app.request("/api/shorts/judgment/export?agent=hermes")).json();
  assert.equal(body.path, "~/.hermes/skills/review-rules/SKILL.md");
});

test("Cursor rules use .mdc frontmatter", async () => {
  const body = await (await app.request("/api/shorts/route/export?agent=cursor")).json();
  assert.equal(body.path, ".cursor/rules/pstack-route.mdc");
  assert.match(body.content, /alwaysApply: false/);
});

test("rejects unknown agents and shorts", async () => {
  assert.equal((await app.request("/api/shorts/grill/export?agent=skynet")).status, 400);
  assert.equal((await app.request("/api/shorts/nope")).status, 404);
  assert.equal((await app.request("/nope")).status, 404);
});

test("allows the landing site origin and nothing else", async () => {
  const ok = await app.request("/api/shorts", { headers: { Origin: "https://site.example" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://site.example");
  const other = await app.request("/api/shorts", { headers: { Origin: "https://evil.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});
