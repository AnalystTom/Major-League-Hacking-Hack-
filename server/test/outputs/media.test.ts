import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerMedia, mediaFromEnv } from "../../src/outputs/render/media.js";

test("WorkerMedia sends the file to the processor bridge and checks the stored size", async () => {
  const dir = await mkdtemp(join(tmpdir(), "media-test-"));
  try {
    const file = join(dir, "short.mp4");
    await writeFile(file, "abcd");
    const seen: { url: string; auth: string | null; type: string | null }[] = [];
    const reply = (size: number, status = 200): typeof fetch => async (url, init) => {
      const h = new Headers(init?.headers);
      seen.push({ url: String(url), auth: h.get("authorization"), type: h.get("content-type") });
      return Response.json({ size }, { status });
    };
    const store = (fetchImpl: typeof fetch) => new WorkerMedia({ url: "https://p.example/internal/media", token: "t", fetchImpl });
    assert.equal(await store(reply(4)).put("videos/a/1/short.mp4", file, "video/mp4"), "r2:videos/a/1/short.mp4");
    assert.deepEqual(seen[0], { url: "https://p.example/internal/media?key=videos%2Fa%2F1%2Fshort.mp4", auth: "Bearer t", type: "video/mp4" });
    await assert.rejects(store(reply(3)).put("videos/a/1/short.mp4", file, "video/mp4"), /no complete copy/);
    await assert.rejects(store(reply(0, 401)).put("videos/a/1/short.mp4", file, "video/mp4"), /HTTP 401/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("WorkerMedia asks the processor bridge to delete a key and reports a refused delete", async () => {
  const seen: { url: string; method: string | undefined; auth: string | null }[] = [];
  const reply = (status: number): typeof fetch => async (url, init) => {
    seen.push({ url: String(url), method: init?.method, auth: new Headers(init?.headers).get("authorization") });
    return Response.json({ deleted: true }, { status });
  };
  const store = (fetchImpl: typeof fetch) => new WorkerMedia({ url: "https://p.example/internal/media", token: "t", fetchImpl });
  await store(reply(200)).delete("audio/a/1/narration.m4a");
  assert.deepEqual(seen[0], { url: "https://p.example/internal/media?key=audio%2Fa%2F1%2Fnarration.m4a", method: "DELETE", auth: "Bearer t" });
  await assert.rejects(store(reply(500)).delete("audio/a/1/narration.m4a"), /delete of audio\/a\/1\/narration\.m4a failed: HTTP 500/);
});

test("mediaFromEnv uses the processor bridge when D1 is configured, and nothing otherwise", () => {
  assert.ok(mediaFromEnv({ D1_URL: "https://p.example/internal/d1", D1_TOKEN: "t" }) instanceof WorkerMedia);
  assert.equal(mediaFromEnv({}), null);
});
