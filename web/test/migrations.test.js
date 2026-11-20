import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { MIGRATIONS, applyMigrations } from "./migrations.js";

test("applyMigrations applies every web migration in Wrangler's filename order", () => {
  assert.deepEqual(MIGRATIONS, [...MIGRATIONS].sort());
  assert.equal(MIGRATIONS[0], "0001_waitlist.sql");
  assert.ok(MIGRATIONS.includes("0005_x_oauth.sql") && MIGRATIONS.includes("0010_anonymous_spend_ledgers.sql"));
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  for (const table of ["waitlist", "users", "usage_events", "x_connections", "user_video_requests"]) assert.ok(tables.has(table), table);
  db.close();
});

test("applyMigrations stops before a named migration and rejects unknown names", () => {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db, { before: "0007_video_limits.sql" });
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='user_video_requests'").get().n, 0);
  assert.throws(() => applyMigrations(db, { before: "9999_missing.sql" }), /Unknown migration/);
  db.close();
});

test("tests build schemas only through applyMigrations", () => {
  const roots = [new URL("./", import.meta.url), new URL("../../server/test/", import.meta.url)];
  const offenders = roots.flatMap((root) => readdirSync(root, { recursive: true })
    .filter((name) => /\.(js|ts)$/.test(name) && !name.endsWith("migrations.js") && !name.endsWith("migrations.test.js"))
    .filter((name) => /migrations\/[^'"`]*\.sql|migrations\/\$\{/.test(readFileSync(new URL(name, root), "utf8")))
    .map((name) => new URL(name, root).pathname));
  assert.deepEqual(offenders, []);
});
