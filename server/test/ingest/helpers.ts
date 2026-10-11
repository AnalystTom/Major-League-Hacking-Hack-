import { randomUUID } from "node:crypto";
import type { IngestedUnit } from "../../src/ingest/types.js";

export function pendingUnit(videoId: string, start: number | null = null): IngestedUnit {
  return {
    id: randomUUID(), submittedUrl: `https://www.youtube.com/watch?v=${videoId}&list=WL&index=4`,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`, startSeconds: start, title: null, transcript: null,
    extractionMethod: null, extractedAt: null, status: "pending", error: null,
  };
}

/** Routes Gemini, YouTube oEmbed and OpenAI calls to canned replies and counts them. */
export function mockFetch(opts: { failVideo?: string; digestStatus?: () => number; title?: string | null } = {}) {
  const calls = { gemini: 0, openai: 0, oembed: 0, lastDigestRequest: null as unknown };
  const impl = (async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("oembed")) {
      calls.oembed++;
      return opts.title === null ? new Response("nope", { status: 404 }) : Response.json({ title: opts.title ?? "Real Title" });
    }
    if (u.includes("generativelanguage")) {
      calls.gemini++;
      const text: string = JSON.parse(init!.body!).contents[0].parts[1].text;
      const video = /\?v=([\w-]{11})/.exec(text)![1];
      if (video === opts.failVideo) return new Response("denied", { status: 403 });
      const lo = Number(/seconds (\d+) to/.exec(text)![1]);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        source_url: `https://www.youtube.com/watch?v=${video}`, content_accessed: true,
        evidence_items: [{ start_seconds: lo + 5, end_seconds: lo + 20, observed_spoken_content: `about ${video}` }] }) }] } }] });
    }
    if (u.includes("openai")) {
      calls.openai++;
      const status = opts.digestStatus?.() ?? 200;
      if (status !== 200) return new Response("boom", { status });
      const sent = JSON.parse(JSON.parse(init!.body!).messages[1].content);
      calls.lastDigestRequest = sent;
      const units = sent.units as { id: string; evidence_items: { start_seconds: number; end_seconds: number }[] }[];
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        artifacts: [{ name: "topic", source_ids: units.map((x) => x.id), category: "c", processed_text: "t", selection_reason: "r",
          evidence: [{ source_id: units[0].id, ...units[0].evidence_items[0], passage: "p" }] }],
        exclusions: [] }) } }] });
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

