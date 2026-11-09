import test from "node:test";
import assert from "node:assert/strict";
import app from "../src/index.js";
import { constantTimeEqual } from "../src/site-gate.js";

const secrets = { SITE_GATE_USER: "fixture-owner", SITE_GATE_PASSWORD: "fixture:password-é" };
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const valid = basic(secrets.SITE_GATE_USER, secrets.SITE_GATE_PASSWORD);
const paths = ["/", "/app.js", "/favicon.svg", "/available", "/api/me", "/api/waitlist", "/media/test.mp4", "/api/auth/x/callback?state=s&code=c"];
const call = (path, env, authorization) => app.fetch(new Request(`https://resurface.test${path}`, {
  headers: authorization ? { authorization } : {},
}), env, {});

test("constant-time helper compares fixed-size digests for equal, unequal and UTF-8 inputs", () => {
  for (const value of ["", "fixture", "é🔒", "x".repeat(10000)]) {
    assert.equal(constantTimeEqual(value, value), true);
    assert.equal(constantTimeEqual(value, `${value}x`), false);
    assert.equal(constantTimeEqual(`${value}x`, value), false);
  }
  assert.equal(constantTimeEqual("same-length-a", "same-length-b"), false);
});

test("gate challenges every route before accessing assets, database, or provider", async () => {
  for (const path of paths) {
    for (const authorization of [undefined, valid.replace(/.$/, "!"), "Bearer token", "Basic !!!",
      basic(secrets.SITE_GATE_USER, "wrong"), basic("wrong", secrets.SITE_GATE_PASSWORD),
      `Basic ${Buffer.from([255]).toString("base64")}`]) {
      const response = await call(path, secrets, authorization);
      assert.equal(response.status, 401, path);
      assert.equal(response.headers.get("www-authenticate"), 'Basic realm="Resurface", charset="UTF-8"');
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(await response.text(), "Authentication required.");
    }
  }
});

test("gate is off when either secret is missing or empty", async () => {
  for (const bindings of [{}, { SITE_GATE_USER: "owner" }, { SITE_GATE_PASSWORD: "password" },
    { ...secrets, SITE_GATE_USER: "" }, { ...secrets, SITE_GATE_PASSWORD: "" }]) {
    const env = { ...bindings, ASSETS: { fetch: () => new Response("asset") } };
    assert.equal(await (await call("/app.js", env)).text(), "asset");
    assert.equal((await call("/api/me", env)).status, 503);
  }
});

test("valid credentials reach assets and API without replacing application authentication", async () => {
  const env = { ...secrets, ASSETS: { fetch: (request) => new Response(new URL(request.url).pathname) } };
  for (const path of ["/", "/app.js", "/available"]) {
    assert.equal(await (await call(path, env, valid)).text(), path);
  }
  assert.equal((await call("/api/me", env, valid)).status, 503);
  env.DB = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) };
  assert.equal((await call("/api/imports", env, valid)).status, 401);
  assert.deepEqual(await (await call("/api/me", env, valid)).json(), { user: null });
});
