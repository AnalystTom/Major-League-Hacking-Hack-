import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApi } from "../src/api.ts";
import { MemoryStore } from "../src/store.ts";

const ok = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
  source_url: "https://www.youtube.com/watch?v=VQy50fuxI34", content_accessed: true,
  evidence_items: [{ start_seconds: 5, end_seconds: 20, observed_spoken_content: "x" }] }) }] } }] }));

test("POST /imports reports per-link state; bad link shows its error", async () => {
  const server = createApi({ geminiKey: "k", store: new MemoryStore(), context: { name: "p", goal: null, facts: [] }, fetchImpl: ok as typeof fetch, retries: 0 });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = await fetch(`${base}/imports`, { method: "POST", body: JSON.stringify({ links: ["https://www.youtube.com/watch?v=VQy50fuxI34&list=WL", "https://example.com/x"], request: "group by problem" }) });
  assert.equal(post.status, 202);
  const { id } = await post.json();
  let body: any;
  for (let i = 0; i < 50; i++) {
    body = await (await fetch(`${base}/imports/${id}`)).json();
    if (body.links.every((l: any) => l.status === "ready" || l.status === "failed")) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(body.links[0].status, "ready");
  assert.equal(body.links[0].source_url, "https://www.youtube.com/watch?v=VQy50fuxI34");
  assert.equal(body.links[1].status, "failed");
  assert.match(body.links[1].error, /YouTube/);
  assert.equal((await fetch(`${base}/imports`, { method: "POST", body: JSON.stringify({ links: [] }) })).status, 400);
  server.close();
});
