import test from "node:test";
import assert from "node:assert/strict";
import { geminiUsage, openaiUsage, setUsageSink, type Usage } from "../src/usage.js";
import { generateSkill } from "../src/outputs/skills.js";
import { artifact, skillReply } from "./outputs/helpers.js";

test("provider usage shapes become one record format", () => {
  assert.deepEqual(openaiUsage({ prompt_tokens: 1200, completion_tokens: 900, completion_tokens_details: { reasoning_tokens: 600 } }),
    { input_tokens: 1200, output_tokens: 900, reasoning_tokens: 600 });
  assert.deepEqual(geminiUsage({ usageMetadata: { promptTokenCount: 80000, candidatesTokenCount: 1500, thoughtsTokenCount: 500 } }),
    { input_tokens: 80000, output_tokens: 2000, reasoning_tokens: 500 });
  assert.deepEqual(geminiUsage({ usage: { input_tokens: 40, output_tokens: 300 } }), { input_tokens: 40, output_tokens: 300, reasoning_tokens: null });
  assert.deepEqual(geminiUsage({}), { input_tokens: null, output_tokens: null, reasoning_tokens: null });
});

test("a skill call records its tokens against the artifact", async (t) => {
  const seen: Usage[] = [];
  setUsageSink((u) => seen.push(u));
  t.after(() => setUsageSink(() => {}));
  const a = artifact();
  const impl = (async () => Response.json({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(skillReply(a)) } }],
    usage: { prompt_tokens: 2100, completion_tokens: 3400, completion_tokens_details: { reasoning_tokens: 2500 } },
  })) as unknown as typeof fetch;
  await generateSkill(a, { apiKey: "k", model: "gpt-5", fetchImpl: impl });
  assert.deepEqual(seen, [{ step: "skill", provider: "openai", model: "gpt-5", input_tokens: 2100, output_tokens: 3400, reasoning_tokens: 2500, ref: a.id }]);
});
