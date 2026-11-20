import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);

export const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();

export function readMigration(name) {
  return readFileSync(new URL(name, MIGRATIONS_DIR), "utf8");
}

export function applyMigrations(sqlite, { before } = {}) {
  const stop = before === undefined ? MIGRATIONS.length : MIGRATIONS.indexOf(before);
  if (stop < 0) throw new Error(`Unknown migration: ${before}`);
  for (const name of MIGRATIONS.slice(0, stop)) sqlite.exec(readMigration(name));
}
