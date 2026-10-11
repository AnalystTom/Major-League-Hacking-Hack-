import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, parseLogin, parseSignup, readCookie, sessionCookie, verifyPassword } from "../src/auth.js";
import { fromRow, parseProject, toFacts } from "../src/project.js";

test("passwords hash with a fresh salt and verify only the right password", async () => {
  const a = await hashPassword("correct horse battery");
  const b = await hashPassword("correct horse battery");
  assert.match(a, /^pbkdf2-sha256\$100000\$[^$]+\$[^$]+$/);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("correct horse battery", a), true);
  assert.equal(await verifyPassword("correct horse batterY", a), false);
  assert.equal(await verifyPassword("anything", "garbage"), false);
});

test("parseSignup normalises email and enforces password length", () => {
  const ok = parseSignup({ email: "  Tom@Example.DEV ", password: "0123456789", name: " Tom " });
  assert.deepEqual(ok.value, { email: "tom@example.dev", password: "0123456789", name: "Tom" });
  assert.equal(parseSignup({ email: "nope", password: "0123456789" }).ok, false);
  assert.equal(parseSignup({ email: "a@b.co", password: "short" }).ok, false);
  assert.equal(parseSignup({ email: "a@b.co", password: "x".repeat(201) }).ok, false);
  assert.equal(parseSignup({ email: "a@b.co", password: "0123456789" }).value.name, null);
  assert.equal(parseLogin({ email: "a@b.co" }).ok, false);
});

test("session cookie is httpOnly, Secure, SameSite=Lax and readable back", () => {
  const c = sessionCookie("tok_123");
  for (const part of ["rs_session=tok_123", "HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(c.includes(part), part);
  assert.ok(sessionCookie("", 0).includes("Max-Age=0"));
  assert.equal(readCookie("a=1; rs_session=tok_123; b=2", "rs_session"), "tok_123");
  assert.equal(readCookie("a=1", "rs_session"), null);
  assert.equal(readCookie(null, "rs_session"), null);
});

test("parseProject cleans the brief and keeps only known agents", () => {
  const p = parseProject({ name: "  Resurface ", goal: "Ship  the\\nfeed", tools: "TypeScript, Postgres, TypeScript,  ", agents: ["codex", "skynet", "codex"] });
  assert.equal(p.ok, true);
  assert.deepEqual(p.value, { name: "Resurface", goal: "Ship the\\nfeed", tools: ["TypeScript", "Postgres"], agents: ["codex"] });
  assert.equal(parseProject({ name: " " }).ok, false);
  assert.equal(parseProject({ name: "x", tools: Array(40).fill(0).map((_, i) => `t${i}`) }).value.tools.length, 20);
});

test("project facts round-trip through project_contexts rows", () => {
  const facts = toFacts({ tools: ["Postgres"], agents: ["claude-code"] });
  assert.deepEqual(facts, [
    { kind: "tool", fact: "Postgres", source: "onboarding" },
    { kind: "agent", fact: "Claude Code", id: "claude-code", source: "onboarding" },
  ]);
  const back = fromRow({ id: "p", version: 2, name: "R", goal: null, facts });
  assert.deepEqual(back, { id: "p", version: 2, name: "R", goal: null, tools: ["Postgres"], agents: ["claude-code"] });
});
