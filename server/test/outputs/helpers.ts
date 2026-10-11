import { randomUUID } from "node:crypto";
import { pcmToWav } from "../../src/outputs/render/tts.js";
import type { ReadyArtifact } from "../../src/outputs/types.js";
import type { Kind, MemoryOutputStore } from "../../src/outputs/store.js";

export function artifact(over: Partial<ReadyArtifact> = {}): ReadyArtifact {
  const unit = randomUUID();
  return {
    id: randomUUID(), version: 1, name: "Write the check before the agent says done", category: "Agent evals",
    processed_text: "A coding agent declares success unless a failing check forces it to prove the change works.",
    selection_reason: "Grounded in the talk's evals segment.", source_ids: [unit],
    sources: [{ url: "https://www.youtube.com/watch?v=VQy50fuxI34", title: "Evals for coding agents" }],
    evidence: [{ source_id: unit, start_seconds: 30, end_seconds: 60, passage: "write the failing test first" }],
    ...over,
  };
}

/** A real WAV: a quiet 440 Hz tone, 16-bit mono 24 kHz. */
export function toneWav(seconds: number): Buffer {
  const n = Math.round(24_000 * seconds);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 24_000) * 3000), i * 2);
  return pcmToWav(pcm);
}

export const skillReply = (a: ReadyArtifact, over: Record<string, unknown> = {}) => ({
  skill: { name: "Verify Before Done!", description: "Make the agent prove a change with a failing check first.", body: "# Verify before done\n\n1. Find the test command." },
  action_items: [{
    task: "Add a failing test for the next change", applicability_evidence: [{ source_id: a.source_ids[0], passage: "write the failing test first" }],
    prerequisites: ["A test runner"], steps: ["Inspect the repo's test setup", "Write the failing test"], source_refs: [a.source_ids[0]],
    completion_check: "The new test fails before the change and passes after it.",
  }],
  ...over,
});

export const scriptReply = (a: ReadyArtifact) => ({
  scenes: [
    { narration_text: "Your coding agent says it's done. Is it, though? Most of the time nobody actually checked the change it made.", on_screen_text: "Done? Prove it.", visual_instruction: "title", source_ids: [] },
    { narration_text: "The talk's fix is simple. Write a failing check before the agent starts, so success means a red test turning green.", on_screen_text: "Failing check first", visual_instruction: "test", source_ids: [a.source_ids[0]] },
    { narration_text: "Then the agent can't declare victory by itself. It has to run the check and show you the result.", on_screen_text: "Run it. Show it.", visual_instruction: "terminal", source_ids: [a.source_ids[0]] },
    { narration_text: "Next time you hand off a task, write the check first and make it part of the request.", on_screen_text: "Check first, every time", visual_instruction: "cta", source_ids: [] },
  ],
});

/** Routes OpenAI (skill or script, told apart by the system prompt) and Gemini TTS to canned replies. */
export function outputsFetch(a: ReadyArtifact, opts: { skill?: unknown; ttsStatus?: number; openaiStatus?: number } = {}) {
  const calls = { skill: 0, script: 0, tts: 0 };
  const impl = (async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("openai")) {
      if (opts.openaiStatus) return new Response("boom", { status: opts.openaiStatus });
      const system: string = JSON.parse(init!.body!).messages[0].content;
      const isScript = system.includes("narration for a 30-45 second");
      calls[isScript ? "script" : "skill"]++;
      const content = isScript ? scriptReply(a) : (opts.skill ?? skillReply(a));
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
    }
    if (u.includes("interactions")) {
      calls.tts++;
      if (opts.ttsStatus) return new Response("denied", { status: opts.ttsStatus });
      const text: string = JSON.parse(init!.body!).input[0].content[0].text;
      const seconds = Math.max(1, text.split(/\s+/).length / 2.6);
      return Response.json({ steps: [{ type: "model_output", content: [{ type: "audio", data: toneWav(seconds).toString("base64") }] }] });
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** What a newer worker's claim does to a stale row: the old worker's token stops matching. */
export function takeOver(store: MemoryOutputStore, kind: Kind, id: string) {
  for (const row of store.rows[kind].values()) if (row.id === id) row.token = randomUUID();
}
