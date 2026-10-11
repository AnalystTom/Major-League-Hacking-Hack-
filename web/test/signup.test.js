import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSignup } from "../src/signup.js";

test("accepts and normalises a valid email", () => {
  const r = parseSignup({ email: "  Dev@Example.COM ", agent: "codex", sources: ["youtube", "youtube", "bogus"] });
  assert.deepEqual(r, { ok: true, value: { email: "dev@example.com", agent: "codex", sources: ["youtube"] } });
});

test("rejects malformed email", () => {
  for (const email of ["", "nope", "a@b", "a b@c.com", 42]) {
    assert.equal(parseSignup({ email }).ok, false);
  }
});

test("accepts hermes as an agent", () => {
  assert.equal(parseSignup({ email: "a@b.co", agent: "hermes" }).value.agent, "hermes");
});

test("drops unknown agent", () => {
  assert.equal(parseSignup({ email: "a@b.co", agent: "skynet" }).value.agent, null);
});

test("honeypot is silently ignored", () => {
  assert.deepEqual(parseSignup({ email: "a@b.co", company: "spam inc" }), { ok: false, status: 202, error: "ignored" });
});

test("rejects missing body", () => {
  assert.equal(parseSignup(null).status, 400);
});
