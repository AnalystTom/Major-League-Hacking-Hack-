import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectContext } from "../../src/ingest/context.js";

test("ingestion requires an explicit, valid project brief", async (t) => {
  await assert.rejects(readProjectContext(undefined), /PROJECT_CONTEXT/);
  const dir = await mkdtemp(join(tmpdir(), "resurface-context-"));
  t.after(() => rm(dir, { recursive: true }));
  const path = join(dir, "context.json");
  const context = { id: null, version: null, name: "Resurface", goal: null, tools: [], agents: [] };
  await writeFile(path, JSON.stringify(context));
  assert.deepEqual(await readProjectContext(path), context);
  await writeFile(path, JSON.stringify({ name: null }));
  await assert.rejects(readProjectContext(path));
  await writeFile(path, "{");
  await assert.rejects(readProjectContext(path));
});
