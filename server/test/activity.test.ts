import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { processUnits } from "../src/ingest/processor.js";
import { MemoryStore } from "../src/ingest/store.js";
import { produceOutputs } from "../src/outputs/run.js";
import { MemoryOutputStore } from "../src/outputs/store.js";
import { pendingUnit } from "./ingest/helpers.js";
import { artifact } from "./outputs/helpers.js";

const app = createApp({ webOrigins: [] });
const busy = async () => (await (await app.request("/health")).json()).busy;

/** A fetch that answers with `reply` only once released, so work can be observed mid-flight. */
function held(reply: () => Response) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return { release, impl: (async () => { await gate; return reply(); }) as unknown as typeof fetch };
}

test("/health counts an import while its provider call is still waiting, and drops to 0 after", async () => {
  const store = new MemoryStore();
  const u = pendingUnit("VQy50fuxI34");
  await store.saveUnit(u);
  const { release, impl } = held(() => new Response("denied", { status: 403 }));
  const run = processUnits([u.id], { geminiKey: "k", store, fetchImpl: impl, retries: 0 });
  assert.equal(await busy(), 1);
  release();
  await run;
  assert.equal(await busy(), 0);
});

test("a queued render counts as busy before it starts, as does a running skill", async () => {
  const outputs = new MemoryOutputStore();
  const { release, impl } = held(() => new Response("boom", { status: 500 }));
  const done = produceOutputs([artifact(), artifact()], { outputs, openaiKey: "o", geminiKey: "g", media: { put: async (k) => `r2:${k}` }, fetchImpl: impl });
  assert.equal(await busy(), 4, "two skills running, one render running, one queued");
  release();
  await done;
  assert.equal(await busy(), 0);
});
