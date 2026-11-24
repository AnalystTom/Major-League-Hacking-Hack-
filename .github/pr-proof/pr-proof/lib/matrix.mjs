import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cell = (text) => String(text).trim().replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>") || "(no output)";

const isInfrastructureFailure = (result) => result.code === null || result.code >= 2;

async function runOne(job) {
  let result = await runOnce(job);
  for (let retry = 0; retry < 3 && isInfrastructureFailure(result); retry++) result = await runOnce(job);
  return result;
}

function runOnce({ cwd, headDir, cmd, input, variant, side, timeoutMs }) {
  return new Promise((resolve) => {
    const profile = mkdtempSync(join(tmpdir(), "pr-proof-profile-"));
    const env = { ...process.env, ...variant.env, PR_PROOF_INPUT: input, PR_PROOF_VARIANT: variant.name, PR_PROOF_SIDE: side, PR_PROOF_HEAD_DIR: headDir, PR_PROOF_PROFILE: profile };
    const child = spawn("bash", ["-c", cmd], { cwd, env, detached: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      rmSync(profile, { recursive: true, force: true });
      const lines = output.trim().split("\n").filter(Boolean);
      resolve({ code: signal ? null : code, ok: signal === null && code === 0, observation: signal ? "timeout" : lines.at(-1) ?? "(no output)" });
    });
  });
}

async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

const countOf = (passed, total) => `${passed} of ${total}`;

const numbersIn = (text) => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const skeleton = (text) => text.replace(/-?\d+(?:\.\d+)?/g, "#");

function observationsMatch(left, right, tolerance = 0) {
  if (skeleton(left) !== skeleton(right)) return false;
  const a = numbersIn(left);
  const b = numbersIn(right);
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
}

export async function runMatrix({ specPath, baseDir, headDir, baseLabel, headLabel, parallel = 4, timeoutMs = 180000, jsonPath }) {
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const jobs = [];
  for (const variant of spec.variants) {
    spec.groups.forEach((group, groupIndex) => {
      group.cases.forEach((testCase) => {
        for (const side of ["base", "head"]) jobs.push({ variant, group, groupIndex, testCase, side });
      });
    });
  }
  const results = await pool(
    jobs.map((job) => async () => {
      const result = { ...job, ...(await runOne({ cwd: job.side === "base" ? baseDir : headDir, headDir, cmd: spec.cmd, input: job.testCase.input, variant: job.variant, side: job.side, timeoutMs })) };
      if (jsonPath) appendFileSync(`${jsonPath}l`, `${JSON.stringify({ variant: job.variant.name, case: job.testCase.input, side: job.side, ok: result.ok, observation: result.observation })}\n`);
      return result;
    }),
    parallel
  );
  const find = (variant, groupIndex, testCase, side) => results.find((r) => r.variant.name === variant.name && r.groupIndex === groupIndex && r.testCase === testCase && r.side === side);
  const passes = (variant, group, groupIndex, testCase) => {
    const head = find(variant, groupIndex, testCase, "head");
    const base = find(variant, groupIndex, testCase, "base");
    if (group.compare === "same-as-base") return { head: head.ok && base.ok && observationsMatch(head.observation, base.observation, group.tolerance), base: null };
    return { head: head.ok, base: base.ok };
  };
  const summary = spec.groups.map((group, groupIndex) => {
    const cells = spec.variants.map((variant) => {
      const verdicts = group.cases.map((testCase) => passes(variant, group, groupIndex, testCase));
      const head = verdicts.filter((v) => v.head).length;
      if (group.compare === "same-as-base") return `${countOf(head, group.cases.length)} match base`;
      const base = verdicts.filter((v) => v.base).length;
      return `**${countOf(head, group.cases.length)}** (base ${countOf(base, group.cases.length)})`;
    });
    return `| ${cell(group.title)} | ${cells.join(" | ")} |`;
  });
  const detail = [];
  for (const variant of spec.variants) {
    spec.groups.forEach((group, groupIndex) => {
      for (const testCase of group.cases) {
        const base = find(variant, groupIndex, testCase, "base");
        const head = find(variant, groupIndex, testCase, "head");
        const verdict = passes(variant, group, groupIndex, testCase);
        detail.push(`| ${cell(testCase.label ?? testCase.input)} | ${variant.name} | ${base.ok ? "✅" : "❌"} ${cell(base.observation)} | ${head.ok ? "✅" : "❌"} ${cell(head.observation)}${group.compare === "same-as-base" ? (verdict.head ? " (matches base)" : " (differs from base)") : ""} |`);
      }
    });
  }
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(results.map(({ variant, group, testCase, side, ok, observation }) => ({ variant: variant.name, group: group.title, case: testCase.input, side, ok, observation })), null, 2));
  const header = `| ${spec.rowHeading ?? ""} | ${spec.variants.map((v) => cell(v.title ?? v.name)).join(" | ")} |`;
  const rule = `|---|${spec.variants.map(() => "---|").join("")}`;
  return `${header}\n${rule}\n${summary.join("\n")}\n\n<details><summary>Every run, verbatim (${results.length} runs, each from a fresh profile)</summary>\n\n| Case | Variant | Base \`${baseLabel}\` | This branch \`${headLabel}\` |\n|---|---|---|---|\n${detail.join("\n")}\n\n</details>\n`;
}
