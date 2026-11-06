import test from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_TTS_MODEL, narrationVoice, pcmToWav, resetTtsQuotaPause, synthesize, TTS_MODEL } from "../../src/outputs/render/tts.js";

const fallback = { url: "http://processor/internal/tts", token: "t" };

test("a Gemini quota error narrates with the Workers AI fallback, then skips Gemini for a while", async () => {
  resetTtsQuotaPause();
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).includes("generativelanguage")) return new Response("quota", { status: 429 });
    assert.equal(new Headers(init!.headers).get("authorization"), "Bearer t");
    assert.deepEqual(JSON.parse(String(init!.body)), { text: "Run code review first." });
    return new Response(pcmToWav(Buffer.alloc(8)));
  }) as unknown as typeof fetch;
  assert.equal(narrationVoice(undefined, fallback), TTS_MODEL);
  const wav = await synthesize("Run code review first.", { apiKey: "k", fetchImpl, fallback });
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(narrationVoice(undefined, fallback), FALLBACK_TTS_MODEL);
  await synthesize("Run code review first.", { apiKey: "k", fetchImpl, fallback });
  assert.deepEqual(calls.map((u) => u.includes("generativelanguage") ? "gemini" : "fallback"), ["gemini", "fallback", "fallback"]);
  resetTtsQuotaPause();
});

test("without a fallback, a Gemini quota error still fails with the provider's status", async () => {
  resetTtsQuotaPause();
  const fetchImpl = (async () => new Response("quota", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(synthesize("hi", { apiKey: "k", fetchImpl, fallback: null, retries: 0 }), /TTS HTTP 429/);
  assert.equal(narrationVoice(undefined, null), TTS_MODEL);
});
