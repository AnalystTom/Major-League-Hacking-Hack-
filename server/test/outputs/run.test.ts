import { JUDGE_SYSTEM_PROMPT, publicationJudgment } from "../../src/outputs/render/judge.js";
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { LostClaim, MAX_OUTPUT_ATTEMPTS, MemoryOutputStore } from "../../src/outputs/store.js";
import { produceOutputs, sweepOutputs } from "../../src/outputs/run.js";
import type { MediaStore } from "../../src/outputs/render/media.js";
import { artifact, outputsFetch, takeOver, approvedJudgment, toneWav } from "./helpers.js";
import type { RenderedVideo } from "../../src/outputs/types.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"]); return true; } catch { return false; } })();
// These cover the plain ffmpeg renderer; motion-skill.test.ts covers the motion-graphic-skill path.
process.env.RENDER_STYLE = "basic";

const media: MediaStore = { put: async (key) => `r2:${key}` };

test("an artifact gets a ready skill and a ready short, once", { skip: !hasFfmpeg && "ffmpeg not installed", timeout: 360_000 }, async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  const { impl, calls } = outputsFetch(a);
  const o = { outputs, openaiKey: "o", geminiKey: "g", media, fetchImpl: impl };
  await Promise.all([produceOutputs([a], o), produceOutputs([a], o)]);
  const skill = [...outputs.rows.skill.values()];
  const video = [...outputs.rows.video.values()];
  assert.equal(skill.length, 1);
  assert.equal(skill[0].status, "ready");
  assert.equal(video.length, 1);
  assert.equal(video[0].status, "ready", String(video[0].error));
  assert.equal(calls.skill, 1, "duplicate requests don't pay twice");
  assert.equal(calls.script, 2);
});

test("without media storage the short fails with that reason, and the skill still lands", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  const { impl, calls } = outputsFetch(a);
  await produceOutputs([a], { outputs, openaiKey: "o", geminiKey: "g", media: null, fetchImpl: impl });
  assert.equal([...outputs.rows.skill.values()][0].status, "ready");
  const v = [...outputs.rows.video.values()][0];
  assert.equal(v.status, "failed");
  assert.match(v.error!, /Media storage isn't configured/);
  assert.equal(calls.script, 0, "nothing is spent on a render that can't be stored");
});

test("a skill failure is recorded with the provider error", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  const { impl } = outputsFetch(a, { openaiStatus: 500 });
  await produceOutputs([a], { outputs, openaiKey: "o", media: null, fetchImpl: impl });
  const s = [...outputs.rows.skill.values()][0];
  assert.equal(s.status, "failed");
  assert.match(s.error!, /OpenAI HTTP 500/);
});

test("a failed skill is retried by the sweep until it lands, at most MAX_OUTPUT_ATTEMPTS times", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore(0);
  outputs.artifacts.push(a);
  const failing = outputsFetch(a, { openaiStatus: 500 });
  const o = { outputs, openaiKey: "o", media: null, fetchImpl: failing.impl };
  await produceOutputs([a], o);
  const row = () => [...outputs.rows.skill.values()][0];
  assert.equal(row().status, "failed");
  await sweepOutputs(o);
  assert.equal(row().attempts, 2);
  assert.equal(row().status, "failed");
  await sweepOutputs({ ...o, fetchImpl: outputsFetch(a).impl });
  assert.equal(row().status, "ready", "the third attempt succeeds");
  assert.equal(row().attempts, 3);

  const b = artifact();
  const stuck = new MemoryOutputStore(0);
  stuck.artifacts.push(b);
  const down = { outputs: stuck, openaiKey: "o", media: null, fetchImpl: outputsFetch(b, { openaiStatus: 500 }).impl };
  for (let i = 0; i < 5; i++) await sweepOutputs(down);
  const s = [...stuck.rows.skill.values()][0];
  assert.equal(s.attempts, 3);
  assert.equal(s.status, "failed", "after three failures it stays failed with the last error");
  assert.match(s.error!, /OpenAI HTTP 500/);
});

test("a failed result waits before it's retried", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  await produceOutputs([a], { outputs, openaiKey: "o", media: null, fetchImpl: outputsFetch(a, { openaiStatus: 500 }).impl });
  outputs.artifacts.push(a);
  assert.equal((await outputs.artifactsNeeding("skill", 10)).length, 0);
});

test("the sweep produces outputs for artifacts that are missing them", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  outputs.artifacts.push(a);
  const { impl } = outputsFetch(a);
  const o = { outputs, openaiKey: "o", media: null, fetchImpl: impl };
  assert.equal(await sweepOutputs(o), 2);
  assert.equal(await sweepOutputs(o), 0, "settled results aren't redone");
});

test("a worker whose claim was taken over can't save or fail the result", async () => {
  const a = artifact();
  const outputs = new MemoryOutputStore();
  const stale = (await outputs.claim("video", a))!;
  takeOver(outputs, "video", stale.id);
  await assert.rejects(outputs.finishVideo(stale, { script: { scenes: [] }, prompt_revision: "r", media_ref: "m", caption_ref: "c", narration_ref: "n", duration_seconds: 1 }), LostClaim);
  assert.equal(await outputs.fail("video", stale, "late"), false);
  assert.equal([...outputs.rows.video.values()][0].status, "running", "the newer worker's row is untouched");
});

for (const status of ["ready", "failed"] as const) for (const success of [true, false]) {
  test(`memory ${status} video refresh retains publication and settles once (${success ? "pass" : "fail"})`, async () => {
    const a = artifact(), outputs = new MemoryOutputStore(0);
    outputs.artifacts.push(a);
    const old: RenderedVideo = { judgment: approvedJudgment(),
      script: { scenes: [] }, prompt_revision: "script-v2", media_ref: "r2:videos/old/short.mp4",
      caption_ref: "r2:captions/old/short.vtt", narration_ref: "r2:audio/old/narration.m4a", duration_seconds: 30 };
    await outputs.finishVideo((await outputs.claim("video",a))!,old);
    const row = [...outputs.rows.video.values()][0];
    Object.assign(row,{status,attempts:3,generatorRevision:"short-v1"});
    const claims = await Promise.all([outputs.claim("video",a),outputs.claim("video",a)]);
    assert.equal(claims.filter(Boolean).length,1);
    const claim = claims.find(Boolean)!;
    const held = [...outputs.rows.video.values()][0];
    assert.equal(held.status,status === "ready" ? "ready" : "running");
    assert.equal(held.value,old);
    assert.deepEqual(await outputs.artifactsNeeding("video",10),[]);
    const replacement = {...old,media_ref:"r2:videos/replacement/short.mp4"};
    if (success) {
      await outputs.finishVideo(claim,replacement);
      assert.equal(held.status,"ready");
      assert.equal(held.value,replacement);
    } else {
      await assert.rejects(outputs.finishVideo(claim,{...replacement,judgment:{...old.judgment,passed:false}}),/quality judge/);
      const reviewed = approvedJudgment();
      reviewed.reviews[1].scores.grounding = 2;
      const rejected = publicationJudgment(reviewed.reviews, [], reviewed.cue_checks);
      assert.equal(await outputs.fail("video",claim,"Quality judge rejected: unsupported claim",rejected),true);
      assert.deepEqual(held.rejectedReview, rejected);
      assert.equal(held.status,status);
      assert.equal(held.value,old);
      assert.equal(held.attempts,4);
    }
    await assert.rejects(outputs.finishVideo(claim,replacement),LostClaim);
    assert.equal(await outputs.fail("video",claim,"late"),false);
    assert.equal(await outputs.claim("video",a),null);
    assert.deepEqual(await outputs.artifactsNeeding("video",10),[]);
  });
}

for (const stage of ["revision", "narration", "render", "judge", "video", "caption", "audio"] as const) {
  test(`transient ${stage} failure after critique preserves receipts and retry eligibility`, { skip: !hasFfmpeg && "ffmpeg not installed", timeout: 120_000 }, async () => {
    const a = artifact(), outputs = new MemoryOutputStore(0);
    outputs.artifacts.push(a);
    const { impl } = outputsFetch(a);
    const font = process.env.RENDER_FONT;
    let firstReviewed = false, uploadFailed = false;
    const uploads: string[] = [];
    const o = { outputs, openaiKey: "o", geminiKey: "g",
      media: { put: async (key: string) => {
        uploads.push(key);
        if (!uploadFailed && key.startsWith(`${stage === "video" ? "videos" : stage === "caption" ? "captions" : stage === "audio" ? "audio" : "no-upload-failure"}/`)) {
          uploadFailed = true;
          throw new Error("R2 HTTP 503: temporarily unavailable");
        }
        return `r2:${key}`;
      } },
      fetchImpl: (async (url, init) => {
        const body = JSON.parse(String(init?.body));
        if (String(url).includes("interactions")) {
          if (stage === "narration" && firstReviewed) return new Response("temporary", { status: 503 });
          return Response.json({ steps: [{ type: "model_output", content: [{ type: "audio", data: toneWav(.8).toString("base64") }] }] });
        }
        if (body.messages[0].content === JUDGE_SYSTEM_PROMPT) {
          const evidence = JSON.parse(body.messages[1].content[0].text);
          if (stage === "judge" && evidence.round === 2) return new Response("temporary", { status: 503 });
          const response = await impl(url, init);
          if (evidence.round === 1) {
            firstReviewed = true;
            if (stage === "render") process.env.RENDER_FONT = join(process.cwd(), "missing-transient-render-font.ttf");
          }
          return response;
        }
        if (stage === "revision" && body.messages[1].content.includes("previous_scenes")) return new Response("temporary", { status: 503 });
        return impl(url, init);
      }) as typeof fetch,
    };
    try {
      await produceOutputs([a], o);
      const row = [...outputs.rows.video.values()][0];
      const uploaded = ["video", "caption", "audio"].includes(stage);
      assert.equal(row.status, "failed");
      assert.equal(row.attempts, 1, "infrastructure errors do not exhaust ordinary attempts");
      assert.match(row.error!, stage === "render" ? /ENOENT/ : stage === "narration" ? /TTS HTTP 503/ : uploaded ? /^R2 HTTP 503/ : /OpenAI HTTP 503/);
      assert.doesNotMatch(row.error!, /Quality judge rejected/);
      assert.equal(row.rejectedReview!.reviews.length, uploaded ? 2 : 1);
      assert.equal(row.rejectedReview!.cue_checks.length, ["revision", "narration"].includes(stage) ? 1 : 2);
      assert.equal(row.rejectedReview!.passed, uploaded, "passing critiques stay passing when an upload fails");
      assert.match(row.rejectedReview!.review_log, /## Round 1/);
      if (uploaded) assert.match(row.rejectedReview!.review_log, /## Round 2/);
      assert.equal(uploads.length, uploaded ? ["video", "caption", "audio"].indexOf(stage) + 1 : 0);
      assert.equal((await outputs.artifactsNeeding("video", 10))[0].id, a.id);
      if (stage === "video") {
        await sweepOutputs(o);
        const ready = [...outputs.rows.video.values()][0];
        assert.equal(ready.status, "ready", ready.error ?? "");
        assert.equal(ready.attempts, 2);
        assert.equal((ready.value as RenderedVideo).judgment.reviews.length, 2);
      } else {
        assert.ok(await outputs.claim("video", a), "ordinary failures remain retryable");
      }
    } finally {
      if (font === undefined) delete process.env.RENDER_FONT;
      else process.env.RENDER_FONT = font;
    }
  });
}

for (const status of ["ready", "failed"] as const) {
  test(`legacy ${status} refresh keeps its one-attempt bound after a reviewed upload failure`, { skip: !hasFfmpeg && "ffmpeg not installed", timeout: 120_000 }, async () => {
    const a = artifact(), outputs = new MemoryOutputStore(0);
    outputs.artifacts.push(a);
    const old: RenderedVideo = { judgment: approvedJudgment(), script: { scenes: [] }, prompt_revision: "old",
      media_ref: "r2:videos/old/short.mp4", caption_ref: "r2:captions/old/short.vtt", narration_ref: "r2:audio/old/narration.m4a", duration_seconds: 30 };
    await outputs.finishVideo((await outputs.claim("video", a))!, old);
    Object.assign([...outputs.rows.video.values()][0], { status, generatorRevision: "short-v1" });
    const { impl } = outputsFetch(a);
    await produceOutputs([a], { outputs, openaiKey: "o", geminiKey: "g",
      media: { put: async () => { throw new Error("R2 HTTP 503: temporarily unavailable"); } },
      fetchImpl: async (url, init) => String(url).includes("interactions") ?
        Response.json({ steps: [{ type: "model_output", content: [{ type: "audio", data: toneWav(.8).toString("base64") }] }] }) : impl(url, init),
    });
    const row = [...outputs.rows.video.values()][0];
    assert.equal(row.status, status);
    assert.equal(row.value, old, "previous media and approval remain intact");
    assert.match(row.error!, /^R2 HTTP 503/);
    assert.equal(row.rejectedReview!.passed, true);
    assert.equal(row.rejectedReview!.reviews.length, 2);
    assert.equal(row.rejectedReview!.cue_checks.length, 2);
    assert.ok(row.attempts >= MAX_OUTPUT_ATTEMPTS);
    assert.equal(await outputs.claim("video", a), null);
    assert.deepEqual(await outputs.artifactsNeeding("video", 10), []);
  });
}
