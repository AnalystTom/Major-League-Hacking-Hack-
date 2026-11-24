#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { basename, dirname, join, posix, resolve } from "node:path";
import { isAllowedComment } from "../lint/directives.mjs";
import { composeCiComment, sectionsPresent } from "./lib/ci-comment.mjs";
import { renderInfographic } from "./lib/infographic.mjs";
import { installCi, VENDOR_DIR } from "./lib/install-ci.mjs";
import { runMatrix } from "./lib/matrix.mjs";

const isProofArtifact = (path) => path.startsWith(".pr-proof/") || path.startsWith(`${VENDOR_DIR}/`);

const USAGE = `pr-proof <command> [options]

  check    [--base REF] [--body FILE]   fail on added useEffect, added explanatory comments, and a PR body without proof
  diagram  [--base REF]                 print mermaid diagrams of what the diff changed (floorplan + file imports)
  evidence <file...> [--repo OWNER/REPO]  copy artifacts into .pr-proof/ and print markdown that embeds them
  body     [--base REF] --spec FILE     append diagrams, rules check and file list to the agent-written spec
  create   [--base REF] --title TEXT --body FILE [--dry-run]   check, then open a draft PR with gh
  floorplan-map [--base REF] [--title TEXT] [--summary TEXT] [--notes FILE]   refresh the floorplan, mark this PR as recent work, screenshot the map into .pr-proof/
  prompt-surface [--base REF]           print the Prompt surface section: prompt files changed, token estimates, exact diffs
  runs --cases FILE --cmd COMMAND [--base REF]   run each case on the base and this branch ($PR_PROOF_INPUT holds the input) and print a verbatim input/output table
  matrix --spec FILE [--base REF] [--base-dir DIR] [--head-dir DIR] [--prepare CMD] [--parallel N] [--json FILE]   run every case on every variant (model, browser, viewport) from a fresh profile, on the base and this branch, and print the counts table
  infographic --spec FILE [--out FILE]   render a one-image summary (panels, bars, stats) into .pr-proof/infographic.png
  ci-comment [--base REF] --body FILE [--sha SHA] [--run-url URL] [--commit-url URL]   print the sticky CI review comment; exits 1 when action is required
  install-ci [--dir DIR]                vendor pr-proof into a repo with the GitHub workflow and the Greptile config
  template                              print the standard spec skeleton
  lint-comments [FILES...] [--staged]   fail on any explanatory comment (whole files, or added lines when staged)
  hook-comments                         agent hook: reads an Edit/Write tool call on stdin, fails if it adds a comment

--base defaults to the merge-base with origin/HEAD, main, master or develop.`;

const CODE_EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]);
const SCRIPT_EXT = { py: "py", sh: "sh", bash: "sh", zsh: "sh" };
const MARKUP_COMMENT_EXT = new Set(["css", "scss", "less"]);
const TEST_RE = /(?:\.test\.|\.spec\.|\/tests?\/|__tests__|_test\.(?:py|go)$|(?:^|\/)test_[^/]*\.py$)/;
const E2E_RE = /(?:^|\/)(?:e2e|journeys?|playwright)\/|\.e2e\.[jt]sx?$|integration/i;
const BEHAVIOR_EXT = new Set([...CODE_EXT, "py", "go", "rs", "sh"]);
const ARTIFACT_RE = /!\[[^\]]*\]\([^)]+\)|<video[\s>]|\]\([^)]+\.(?:png|jpe?g|gif|webp|webm|mp4|mov|svg)(?:\?[^)]*)?\)|\.pr-proof\//i;

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else { flags[key] = next; i++; }
    } else rest.push(a);
  }
  return { flags, rest };
}

function repoRoot() {
  return git(["rev-parse", "--show-toplevel"]).trim();
}

function resolveBase(flag) {
  if (typeof flag === "string") return git(["merge-base", flag, "HEAD"]).trim();
  const candidates = [];
  try { candidates.push(git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim()); } catch {}
  candidates.push("origin/main", "main", "origin/master", "master", "origin/develop", "develop");
  for (const ref of candidates) {
    try {
      const base = git(["merge-base", ref, "HEAD"]).trim();
      if (base && base !== git(["rev-parse", "HEAD"]).trim()) return base;
    } catch {}
  }
  throw new Error("could not infer a base; pass --base REF");
}

function changedFiles(base) {
  const status = git(["diff", "--name-status", "-M", `${base}...HEAD`]).trim().split("\n").filter(Boolean);
  const numstat = new Map();
  for (const line of git(["diff", "--numstat", "-M", `${base}...HEAD`]).trim().split("\n").filter(Boolean)) {
    const [add, del, ...pathParts] = line.split("\t");
    const raw = pathParts.join("\t");
    const path = raw.includes("=>") ? raw.replace(/\{[^}]*=> ([^}]*)\}/, "$1").replace(/^.*=> /, "").replace(/\/\//g, "/") : raw;
    numstat.set(path, { add: add === "-" ? 0 : Number(add), del: del === "-" ? 0 : Number(del) });
  }
  return status.filter((line) => !isProofArtifact(line.split("\t").pop())).map((line) => {
    const parts = line.split("\t");
    const code = parts[0][0];
    const path = parts[parts.length - 1];
    const stats = numstat.get(path) ?? { add: 0, del: 0 };
    return { path, status: code, ...stats };
  });
}

function addedLines(base, staged = false) {
  const diff = git(staged ? ["diff", "--cached", "-U0", "--no-color", "-M"] : ["diff", "-U0", "--no-color", "-M", `${base}...HEAD`]);
  const byFile = new Map();
  let current = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      current = line.startsWith("+++ b/") && !isProofArtifact(line.slice(6)) ? line.slice(6) : null;
      if (current && !byFile.has(current)) byFile.set(current, new Set());
    } else if (line.startsWith("@@") && current) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (m) {
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        for (let n = start; n < start + count; n++) byFile.get(current).add(n);
      }
    }
  }
  return byFile;
}

function extOf(path) {
  const m = /\.([^./]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
}

function scanJsComments(text, { css = false } = {}) {
  const found = [];
  let line = 1;
  let i = 0;
  let prev = "";
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "\n") { line++; i++; prev = ""; continue; }
    if (!css && c === "/" && d === "/") {
      const start = i;
      while (i < n && text[i] !== "\n") i++;
      found.push({ startLine: line, endLine: line, text: text.slice(start, i) });
      continue;
    }
    if (c === "/" && d === "*") {
      const start = i;
      const startLine = line;
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { if (text[i] === "\n") line++; i++; }
      i += 2;
      found.push({ startLine, endLine: line, text: text.slice(start, i) });
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < n && text[i] !== c && text[i] !== "\n") { if (text[i] === "\\") i++; i++; }
      i++;
      prev = c;
      continue;
    }
    if (c === "`" && !css) {
      i++;
      while (i < n && text[i] !== "`") { if (text[i] === "\\") i++; else if (text[i] === "\n") line++; i++; }
      i++;
      prev = c;
      continue;
    }
    if (c === "/" && !css && (prev === "" || "(,=:[!&|?{};+-*%>~^".includes(prev))) {
      i++;
      let inClass = false;
      while (i < n && text[i] !== "\n") {
        if (text[i] === "\\") i++;
        else if (text[i] === "[") inClass = true;
        else if (text[i] === "]") inClass = false;
        else if (text[i] === "/" && !inClass) break;
        i++;
      }
      if (text[i] === "/") i++;
      prev = "/";
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return found;
}

function scanHashComments(text, kind) {
  const found = [];
  const lines = text.split("\n");
  let triple = null;
  lines.forEach((raw, idx) => {
    let quote = triple;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (quote) {
        if (quote.length === 3 && raw.startsWith(quote, i)) { quote = null; i += 2; continue; }
        if (c === "\\" && quote.length === 1) { i++; continue; }
        if (quote.length === 1 && c === quote) quote = null;
        continue;
      }
      if (kind === "py" && (raw.startsWith('"""', i) || raw.startsWith("'''", i))) { quote = raw.slice(i, i + 3); i += 2; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === "#") {
        if (kind === "sh" && (raw[i - 1] === "$" || (raw[i - 1] === "{" && raw[i - 2] === "$"))) continue;
        if (kind === "sh" && i > 0 && !/\s/.test(raw[i - 1])) continue;
        found.push({ startLine: idx + 1, endLine: idx + 1, text: raw.slice(i) });
        break;
      }
    }
    triple = quote && quote.length === 3 ? quote : null;
  });
  return found;
}

function commentsIn(path, text) {
  const ext = extOf(path);
  if (CODE_EXT.has(ext)) return scanJsComments(text);
  if (MARKUP_COMMENT_EXT.has(ext)) return scanJsComments(text, { css: true });
  if (SCRIPT_EXT[ext]) return scanHashComments(text, SCRIPT_EXT[ext]);
  return [];
}

function globToRegex(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2; } else { out += ".*"; i += 1; }
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}

function globScore(glob) {
  const first = glob.search(/[*?]/);
  return first === -1 ? 10000 + glob.length : first;
}

function loadConfig(root) {
  const path = join(root, ".pr-proof.json");
  const defaults = { effectAllowedPaths: ["**/lib/ui/**", "**/framework/**", "**/ui-kit/**"], floorplan: "floorplan/architecture.json", requiredSections: [] };
  if (!existsSync(path)) return defaults;
  return { ...defaults, ...JSON.parse(readFileSync(path, "utf8")) };
}

function runCheck(base, root, config) {
  const added = addedLines(base);
  const files = changedFiles(base);
  const effectAllowed = config.effectAllowedPaths.map(globToRegex);
  const effects = [];
  const comments = [];
  for (const [path, lines] of added) {
    if (!lines.size) continue;
    const full = join(root, path);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, "utf8");
    const ext = extOf(path);
    if (CODE_EXT.has(ext) && !effectAllowed.some((re) => re.test(path))) {
      text.split("\n").forEach((src, idx) => {
        if (lines.has(idx + 1) && /\buse(?:Layout)?Effect\b/.test(src)) effects.push({ path, line: idx + 1, text: src.trim() });
      });
    }
    for (const comment of commentsIn(path, text)) {
      let touched = null;
      for (let l = comment.startLine; l <= comment.endLine; l++) if (lines.has(l)) { touched = l; break; }
      if (touched === null || isAllowedComment(comment.text, comment.startLine)) continue;
      comments.push({ path, line: touched, text: comment.text.split("\n")[0].trim().slice(0, 100) });
    }
  }
  const live = files.filter((f) => f.status !== "D");
  const testFiles = live.filter((f) => TEST_RE.test(f.path));
  const e2eTests = testFiles.filter((f) => E2E_RE.test(f.path));
  const unitTests = testFiles.filter((f) => !E2E_RE.test(f.path));
  const behaviorFiles = live.filter((f) => BEHAVIOR_EXT.has(extOf(f.path)) && !TEST_RE.test(f.path) && !/\.config\.|\.d\.ts$/.test(f.path));
  return { files, effects, comments, testFiles, e2eTests, unitTests, behaviorFiles };
}

function checkBody(bodyPath, promptChanged = [], extraSections = []) {
  const problems = [];
  if (!bodyPath) return ["no PR body given (--body FILE)"];
  const body = readFileSync(bodyPath, "utf8");
  const section = (name) => {
    const m = new RegExp(`^#{1,2}\\s+${name}\\b[^\\n]*\\n([\\s\\S]*?)(?=^#{1,2}\\s|(?![\\s\\S]))`, "mi").exec(body);
    return m ? m[1] : null;
  };
  const headings = [...body.matchAll(/^#{1,2}\s+(.+)$/gm)].map((m) => m[1].trim());
  if (headings[0] !== "Before and after") problems.push("the first section must be '## Before and after' (visual first)");
  const visual = section("Before and after");
  if (visual !== null) {
    if (!/^\|\s*-{3,}/m.test(visual)) problems.push("'## Before and after' needs a Before | After table");
    if (!ARTIFACT_RE.test(visual) && !/^Nonvisual:/mi.test(visual)) problems.push("'## Before and after' has no screenshot or video; for a change with nothing visible, add a line starting 'Nonvisual:' with a concrete text comparison");
    if (/\bTODO\b|<replace/i.test(visual)) problems.push("'## Before and after' still contains a TODO placeholder");
  }
  const outcomeSection = section("Outcome");
  if (outcomeSection === null) problems.push("missing '## Outcome' section: 2 to 4 plain sentences on what the user saw before and sees now, then the '**Outcome:**' line");
  else {
    const story = outcomeSection.replace(/\*\*Outcome:\*\*[^\n]*/i, "").trim();
    if (!story) problems.push("'## Outcome' needs the opening story before the Outcome line");
    else if (story.split(/\s+/).length > 90) problems.push("the opening story is over 90 words; shorten it");
  }
  const outcome = /\*\*Outcome:\*\*([^\n]*)/i.exec(body);
  if (!outcome) problems.push("missing a '**Outcome:**' line");
  else if (!/\d/.test(outcome[1])) problems.push("'**Outcome:**' has no measured number (for example '7 of 7 checks pass, 13 -> 12 effects')");
  const forYou = section("What changes for you");
  if (forYou === null) problems.push("missing '## What changes for you': a 3-column table (You do | Base | This PR), one row per thing a user does, including a row where nothing should change");
  else {
    const rows = forYou.split("\n").filter((line) => /^\|/.test(line.trim()) && !/^\|\s*:?-{3,}/.test(line.trim()));
    const widths = rows.map((row) => row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).length);
    if (rows.length < 3 || widths.some((w) => w < 3)) problems.push("'## What changes for you' needs a header plus at least two rows in a 3-column table (You do | Base | This PR)");
    if (/\bTODO\b|<replace/i.test(forYou)) problems.push("'## What changes for you' still contains a TODO placeholder");
  }
  const infographic = section("Infographic");
  if (infographic !== null && !/!\[[^\]]*\]\([^)]+\)/.test(infographic)) problems.push("'## Infographic' has no image; run pr-proof infographic, or delete the section");
  const changed = section("What changed");
  if (changed === null) problems.push("missing '## What changed' section");
  else {
    if (!/^\*\*\d+\.\s+\S/m.test(changed)) problems.push("'## What changed' needs numbered bold groups such as '**1. Title**' followed by bullets");
    const lines = changed.split("\n").map((l) => l.trim()).filter(Boolean);
    const prose = lines.filter((l) => !/^\*\*\d+\./.test(l) && !/^[-*]\s+/.test(l));
    if (prose.length) problems.push("'## What changed' must be bullets under numbered groups, no paragraphs");
    const long = lines.filter((l) => /^[-*]\s+/.test(l) && l.replace(/^[-*]\s+/, "").split(/\s+/).length > 30);
    if (long.length) problems.push(`'## What changed' has ${long.length} bullet(s) over 30 words; one idea per bullet`);
  }
  const live = section("Live results");
  if (live === null) problems.push("missing '## Live results' section");
  else {
    if (!ARTIFACT_RE.test(live)) problems.push("'## Live results' has no screenshot, video or .pr-proof/ artifact");
    if (!/```/.test(live) && !/^\|\s*-{3,}/m.test(live)) problems.push("'## Live results' has no table or fenced output of what was actually run");
    if (/\bTODO\b|<replace/i.test(live)) problems.push("'## Live results' still contains a TODO placeholder");
  }
  const notCovered = section("Not covered");
  if (notCovered === null || !/^[-*]\s+\S/m.test(notCovered)) problems.push("missing '## Not covered' with at least one bullet (write 'Nothing known' only if true)");
  const cost = section("Cost surface");
  if (cost === null || !cost.trim()) problems.push("missing '## Cost surface' (performance, size, tokens or CI time, or say it was not measured)");
  const tests = section("Tests");
  if (tests === null) problems.push("missing '## Tests' section");
  else if (!/red on (?:the )?base|green on (?:the )?base/i.test(tests)) problems.push("'## Tests' must say 'Red on base:' (fails before the change) or 'Green on base:' (refactor guard) for the new tests");
  const arch = section("Architecture impact");
  if (arch === null || !(/```mermaid/.test(arch) || /!\[[^\]]*\]\([^)]+\)/.test(arch))) problems.push("missing '## Architecture impact': run pr-proof floorplan-map, then pr-proof body");
  const delta = section("Code delta");
  if (delta === null || !/```mermaid/.test(delta)) problems.push("missing '## Code delta' mermaid diagram");
  if (section("Rules check") === null) problems.push("missing '## Rules check' section");
  for (const name of extraSections) {
    const extra = section(name);
    if (extra === null || !extra.trim()) problems.push(`missing '## ${name}' section (required by this repo's .pr-proof.json requiredSections), with at least one non-empty line`);
  }
  if (/\{\{[^}]*\}\}/.test(body)) problems.push("the spec still contains {{placeholder}} text from the template");
  if (promptChanged.length && section("Prompt surface") === null) problems.push(`prompt files changed (${promptChanged.slice(0, 3).map((f) => f.path).join(", ")}): '## Prompt surface' is missing; run pr-proof body, and show verbatim input and output runs in Live results (pr-proof runs)`);
  return problems;
}

function testProblem(result, bodyPath) {
  if (!result.behaviorFiles.length || result.e2eTests.length) return null;
  if (bodyPath && /^##\s+Test exemption\b/mi.test(readFileSync(bodyPath, "utf8"))) return null;
  return "no e2e or integration test in the diff; unit tests alone do not count. Add one, or add a '## Test exemption' section saying why none applies";
}

function printCheck(result, bodyProblems, testIssue) {
  const out = [];
  if (testIssue) out.push(`tests: ${testIssue}`);
  if (result.effects.length) {
    out.push(`useEffect added outside the allowed framework layer (${result.effects.length}):`);
    for (const e of result.effects) out.push(`  ${e.path}:${e.line}  ${e.text}`);
  }
  if (result.comments.length) {
    out.push(`explanatory comments added (${result.comments.length}):`);
    for (const c of result.comments) out.push(`  ${c.path}:${c.line}  ${c.text}`);
  }
  if (bodyProblems.length) {
    out.push("PR body problems:");
    for (const p of bodyProblems) out.push(`  ${p}`);
  }
  return out;
}

function loadFloorplan(root, config) {
  const primary = dirname(resolve(root, git(["rev-parse", "--git-common-dir"], { cwd: root }).trim()));
  for (const dir of [root, primary]) {
    const path = join(dir, config.floorplan);
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  }
  return null;
}

function makeNodeMatcher(floorplan) {
  const compiled = floorplan.nodes
    .filter((n) => Array.isArray(n.paths) && n.paths.length)
    .map((n) => ({ node: n, paths: n.paths.map((p) => ({ glob: p, re: globToRegex(p) })), exclude: (n.exclude ?? []).map(globToRegex) }));
  return (path) => {
    let best = null;
    for (const c of compiled) {
      if (c.exclude.some((re) => re.test(path))) continue;
      for (const p of c.paths) {
        if (!p.re.test(path)) continue;
        const score = globScore(p.glob) * 100 + c.node.id.split(".").length;
        if (!best || score > best.score) best = { node: c.node, score };
      }
    }
    return best ? best.node : null;
  };
}

function mapToNodes(files, floorplan) {
  const nodeOf = makeNodeMatcher(floorplan);
  const byNode = new Map();
  const unmapped = [];
  for (const f of files) {
    const node = nodeOf(f.path);
    if (!node) { unmapped.push(f); continue; }
    if (!byNode.has(node.id)) byNode.set(node.id, { node, files: [] });
    byNode.get(node.id).files.push(f);
  }
  return { byNode, unmapped, nodeOf };
}

const mid = (id) => "n_" + id.replace(/[^a-zA-Z0-9]/g, "_");
const mlabel = (text) => String(text).replace(/"/g, "'").replace(/[\[\]{}]/g, "");

function architectureDiagram(files, floorplan, fileEdges) {
  const { byNode, unmapped, nodeOf } = mapToNodes(files, floorplan);
  const nodeById = new Map(floorplan.nodes.map((n) => [n.id, n]));
  const lines = ["flowchart LR"];
  const changedIds = new Set(byNode.keys());
  const neighbour = new Set();
  const edges = [];
  for (const e of floorplan.edges ?? []) {
    const touches = changedIds.has(e.from) || changedIds.has(e.to);
    if (!touches) continue;
    edges.push(e);
    for (const id of [e.from, e.to]) if (!changedIds.has(id) && nodeById.has(id)) neighbour.add(id);
  }
  for (const { node, files: fs } of byNode.values()) {
    const add = fs.reduce((s, f) => s + f.add, 0);
    const del = fs.reduce((s, f) => s + f.del, 0);
    const created = fs.filter((f) => f.status === "A").length;
    const note = `${fs.length} file${fs.length === 1 ? "" : "s"}${created ? `, ${created} new` : ""}, +${add} -${del}`;
    lines.push(`  ${mid(node.id)}["${mlabel(node.label ?? node.id)}<br/>${note}"]:::changed`);
  }
  const inferred = new Map();
  for (const [from, to] of fileEdges) {
    const a = nodeOf(from);
    const b = nodeOf(to);
    if (!a || !b || a.id === b.id) continue;
    if (!changedIds.has(a.id) && !changedIds.has(b.id)) continue;
    const declared = edges.some((e) => e.from === a.id && e.to === b.id);
    if (declared) continue;
    inferred.set(a.id + ">" + b.id, [a.id, b.id]);
    if (!changedIds.has(b.id)) neighbour.add(b.id);
    if (!changedIds.has(a.id)) neighbour.add(a.id);
  }
  for (const id of neighbour) lines.push(`  ${mid(id)}["${mlabel(nodeById.get(id).label ?? id)}"]:::context`);
  for (const e of edges) lines.push(`  ${mid(e.from)} -->|"${mlabel(e.label ?? e.kind ?? "")}"| ${mid(e.to)}`);
  for (const [from, to] of inferred.values()) lines.push(`  ${mid(from)} -.->|"imports"| ${mid(to)}`);
  if (unmapped.length) lines.push(`  unmapped["Not in the floorplan<br/>${unmapped.length} file${unmapped.length === 1 ? "" : "s"}"]:::unmapped`);
  lines.push("  classDef changed fill:#fde68a,stroke:#b45309,color:#1f2937;");
  lines.push("  classDef context fill:#f3f4f6,stroke:#9ca3af,color:#374151;");
  lines.push("  classDef unmapped fill:#fecaca,stroke:#b91c1c,color:#1f2937;");
  const touchedFlows = (floorplan.flows ?? []).filter((flow) => (flow.steps ?? []).some((s) => changedIds.has(s.node)));
  return { mermaid: lines.join("\n"), byNode, unmapped, touchedFlows, edges };
}

function tsAliases(root) {
  const path = join(root, "tsconfig.json");
  if (!existsSync(path)) return [];
  try {
    const stripped = readFileSync(path, "utf8").replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "$1").replace(/,(\s*[}\]])/g, "$1");
    const cfg = JSON.parse(stripped);
    const paths = cfg.compilerOptions?.paths ?? {};
    return Object.entries(paths).map(([k, v]) => ({ prefix: k.replace(/\*$/, ""), target: String(v[0]).replace(/^\.\//, "").replace(/\*$/, "") }));
  } catch { return []; }
}

function resolveImport(from, spec, root, aliases) {
  let base;
  if (spec.startsWith(".")) base = posix.normalize(posix.join(dirname(from), spec));
  else {
    const alias = aliases.find((a) => spec.startsWith(a.prefix));
    if (!alias) return null;
    base = posix.normalize(alias.target + spec.slice(alias.prefix.length));
  }
  for (const suffix of ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"]) {
    const candidate = base + suffix;
    if (isFile(join(root, candidate))) return candidate;
  }
  return null;
}

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function importEdges(files, root) {
  const known = new Set(files.map((f) => f.path));
  const aliases = tsAliases(root);
  const edges = [];
  for (const f of files.filter((x) => x.status !== "D" && CODE_EXT.has(extOf(x.path)))) {
    const text = readFileSync(join(root, f.path), "utf8");
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)) {
      const target = resolveImport(f.path, m[1], root, aliases);
      if (target) edges.push([f.path, target]);
    }
  }
  return { edges, known };
}

function codeDeltaDiagram(files, root, allEdges) {
  const deleted = files.filter((f) => f.status === "D");
  const lines = ["flowchart LR"];
  const ids = new Map();
  const idFor = (path) => { if (!ids.has(path)) ids.set(path, "f" + ids.size); return ids.get(path); };
  const kind = new Map(files.map((f) => [f.path, f.status === "A" ? "added" : f.status === "D" ? "deleted" : "modified"]));
  const status = new Map(files.map((f) => [f.path, f.status]));
  const edges = [];
  const external = new Set();
  for (const [from, to] of allEdges.edges) {
    if (allEdges.known.has(to) || status.get(from) === "A") {
      edges.push([from, to]);
      if (!allEdges.known.has(to)) external.add(to);
    }
  }
  const shown = files.filter((f) => f.status !== "D" && (CODE_EXT.has(extOf(f.path)) || extOf(f.path) === "css"));
  if (!shown.length && !deleted.length) return null;
  const sorted = shown.slice(0, 40);
  for (const f of sorted) {
    const label = `${basename(f.path)}<br/>${kind.get(f.path)} +${f.add} -${f.del}`;
    lines.push(`  ${idFor(f.path)}["${mlabel(label)}"]:::${kind.get(f.path)}`);
  }
  for (const f of deleted.slice(0, 10)) lines.push(`  ${idFor(f.path)}["${mlabel(basename(f.path))}<br/>deleted -${f.del}"]:::deleted`);
  for (const path of external) lines.push(`  ${idFor(path)}["${mlabel(basename(path))}"]:::context`);
  const drawn = new Set();
  for (const [from, to] of edges) {
    if (!ids.has(from) || !ids.has(to)) continue;
    const key = from + ">" + to;
    if (drawn.has(key)) continue;
    drawn.add(key);
    lines.push(`  ${idFor(from)} -->|imports| ${idFor(to)}`);
  }
  lines.push("  classDef added fill:#bbf7d0,stroke:#15803d,color:#1f2937;");
  lines.push("  classDef modified fill:#fde68a,stroke:#b45309,color:#1f2937;");
  lines.push("  classDef deleted fill:#fecaca,stroke:#b91c1c,color:#1f2937;");
  lines.push("  classDef context fill:#f3f4f6,stroke:#9ca3af,color:#374151;");
  return lines.join("\n");
}

function renderDiagrams(base, root, config) {
  const files = changedFiles(base);
  const floorplan = loadFloorplan(root, config);
  const allEdges = importEdges(files, root);
  const arch = floorplan ? architectureDiagram(files, floorplan, allEdges.edges) : { mermaid: null, byNode: new Map(), unmapped: files };
  const delta = codeDeltaDiagram(files, root, allEdges);
  return { files, arch, delta, floorplan };
}

function rulesTable(result, diag) {
  const rows = [];
  rows.push(["No `useEffect` added", result.effects.length ? `❌ ${result.effects.length} added` : "✅ none added outside the framework layer"]);
  rows.push(["No explanatory comments added", result.comments.length ? `❌ ${result.comments.length} added` : "✅ none added"]);
  const kinds = `${result.e2eTests.length} e2e or integration, ${result.unitTests.length} unit`;
  rows.push(["E2E or integration test with the code", result.e2eTests.length ? `✅ ${kinds}` : result.behaviorFiles.length ? `❌ none (${kinds})` : `➖ no behavior files changed (${kinds})`]);
  const total = result.files.length;
  const unmapped = diag.arch.unmapped?.length ?? total;
  rows.push(["Floorplan covers the change", diag.floorplan ? (unmapped ? `⚠️ ${unmapped} of ${total} changed files are not in the floorplan; refresh it` : "✅ every changed file maps to a floorplan node") : "⚠️ no floorplan in this repo"]);
  return ["| Check | Result |", "| --- | --- |", ...rows.map((r) => `| ${r[0]} | ${r[1]} |`)].join("\n");
}

const FLOORPLAN_SKILL = process.env.FLOORPLAN_SKILL ?? join(homedir(), ".claude/skills/repo-floorplan/floorplan");
const CHROMIUM = process.env.PR_PROOF_CHROMIUM ?? "/usr/bin/chromium";
const PLAYWRIGHT = process.env.PR_PROOF_PLAYWRIGHT ?? join(homedir(), ".local/share/mise/installs/playwright/latest/node_modules/playwright/index.mjs");

function primaryCheckout(root) {
  return dirname(resolve(root, git(["rev-parse", "--git-common-dir"], { cwd: root }).trim()));
}

function runFloorplan(script, root) {
  const run = spawnSync("node", [join(FLOORPLAN_SKILL, "scripts", script), root], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`floorplan ${script} failed:\n${run.stdout}\n${run.stderr}`);
  return run.stdout;
}

async function screenshotMap(htmlPath, outDir) {
  const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href);
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForTimeout(1800);
    const skip = page.getByRole("button", { name: "Skip" });
    if (await skip.count()) await skip.first().click();
    await page.getByRole("button", { name: "Overview" }).first().click().catch(() => {});
    await page.waitForTimeout(1800);
    await page.screenshot({ path: join(outDir, "floorplan-overview.png") });
    await page.getByRole("button", { name: /Recent work/ }).first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(outDir, "floorplan-recent.png") });
  } finally {
    await browser.close();
  }
}

async function floorplanMap(base, root, flags) {
  const local = join(root, "floorplan");
  if (!existsSync(local)) {
    const source = join(primaryCheckout(root), "floorplan");
    if (!existsSync(source)) throw new Error("no floorplan for this repo; run the repo-floorplan skill first");
    cpSync(source, local, { recursive: true });
  }
  const refreshed = runFloorplan("refresh.mjs", root);
  const graph = JSON.parse(readFileSync(join(local, "graph.json"), "utf8"));
  const onMap = new Set(graph.files.map((f) => f.p));
  const notes = typeof flags.notes === "string" ? JSON.parse(readFileSync(flags.notes, "utf8")) : {};
  const items = changedFiles(base)
    .filter((f) => f.status !== "D" && onMap.has(f.path))
    .map((f) => ({ ref: f.path, change: f.status === "A" ? "new" : "changed", note: notes[f.path] ?? `${f.status === "A" ? "New in this PR" : "Changed in this PR"}: +${f.add} -${f.del} lines.` }));
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }).trim();
  const task = { title: typeof flags.title === "string" ? flags.title : branch, request: "", summary: typeof flags.summary === "string" ? flags.summary : "", items };
  writeFileSync(join(local, "recent-work.json"), JSON.stringify({ updatedAt: new Date().toISOString(), tasks: [task] }, null, 2));
  const built = runFloorplan("build.mjs", root);
  const outDir = join(root, ".pr-proof");
  mkdirSync(outDir, { recursive: true });
  await screenshotMap(join(local, "index.html"), outDir);
  const missing = /DESCRIPTIONS\s+files\s+(\d+)\/(\d+)/.exec(built);
  const unassigned = /ASSIGNMENT[^\n]*?(\d+) unassigned/.exec(built);
  console.log(`marked ${items.length} of ${changedFiles(base).length} changed files on the map; wrote .pr-proof/floorplan-overview.png and floorplan-recent.png`);
  if (missing && missing[1] !== missing[2]) {
    runFloorplan("describe.mjs", root);
    const emptyFiles = [];
    for (const name of readdirSync(join(local, "descriptions"))) {
      const text = readFileSync(join(local, "descriptions", name), "utf8");
      if (/"description":\s*""/.test(text)) emptyFiles.push(`floorplan/descriptions/${name}`);
    }
    console.log(`warning: ${missing[2] - missing[1]} file(s) have no description. Fill the empty "description" values in: ${emptyFiles.join(", ")} (plain words, what it does for the user), then run this command again`);
  }
  if (unassigned) console.log(`note: ${unassigned[1]} files sit outside every part (add globs in architecture.json)`);
  if (/review/.test(refreshed) && /flagged for review/.test(refreshed) && !/0 flagged for review/.test(refreshed)) console.log("warning: some descriptions are flagged for review");
  return 0;
}

function floorplanImageUrl(root, name, repo) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }).trim();
  return repo ? `https://github.com/${repo}/blob/${branch}/.pr-proof/${name}?raw=true` : `.pr-proof/${name}`;
}

const PROMPT_RE = /(?:^|\/)(?:prompts?|skills?|agents?)\/|(?:^|\/)(?:SKILL|AGENTS|CLAUDE|GEMINI)\.md$|prompt|system[-_]?message|tool[-_]?schemas?|(?:^|\/)instructions?\.(?:md|txt)$/i;
const PROMPT_EXT = new Set(["md", "txt", "ts", "js", "mjs", "py", "json", "yaml", "yml", "go"]);

function promptFiles(files, config) {
  const custom = (config.promptGlobs ?? []).map(globToRegex);
  return files.filter((f) => {
    if (f.path.startsWith(".pr-proof/") || TEST_RE.test(f.path)) return false;
    if (custom.length) return custom.some((re) => re.test(f.path));
    return PROMPT_EXT.has(extOf(f.path)) && PROMPT_RE.test(f.path);
  });
}

const approxTokens = (text) => Math.ceil(text.length / 4);

function promptSurfaceSection(base, root, files, config) {
  const rows = [];
  const diffs = [];
  for (const f of promptFiles(files, config)) {
    let before = "";
    try { before = f.status === "A" ? "" : git(["show", `${base}:${f.path}`], { cwd: root }); } catch { before = ""; }
    const full = join(root, f.path);
    const after = f.status === "D" || !existsSync(full) ? "" : readFileSync(full, "utf8");
    if (before === after) continue;
    const delta = approxTokens(after) - approxTokens(before);
    rows.push(`| \`${f.path}\` | ${approxTokens(before)} → ${approxTokens(after)} (${delta >= 0 ? "+" : ""}${delta}) |`);
    const patch = git(["diff", "-U2", "--no-color", `${base}...HEAD`, "--", f.path], { cwd: root }).split("\n").slice(4).join("\n").trim();
    const lines = patch.split("\n");
    diffs.push(`**\`${f.path}\`**\n\n\`\`\`diff\n${lines.slice(0, 120).join("\n")}${lines.length > 120 ? `\n… +${lines.length - 120} more lines` : ""}\n\`\`\``);
  }
  if (!rows.length) return null;
  return `## Prompt surface\n\nThese files are read by an agent or model, so changing them changes behavior. Token counts are estimates at 4 characters per token.\n\n| Prompt file | Tokens before → after |\n|---|---|\n${rows.join("\n")}\n\n<details><summary>Exact changes</summary>\n\n${diffs.join("\n\n")}\n\n</details>`;
}

function cellText(text) {
  const clean = String(text).trim().replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  return clean.length > 600 ? clean.slice(0, 600) + "…" : clean || "(no output)";
}

function runCase(cwd, cmd, input, timeoutMs) {
  const run = spawnSync("bash", ["-c", cmd], { cwd, env: { ...process.env, PR_PROOF_INPUT: input }, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const text = (run.stdout || run.stderr || "").trim();
  return run.status === 0 ? text : `${text}\n(exit ${run.status ?? "timeout"})`.trim();
}

function runsTable(base, root, flags) {
  if (typeof flags.cases !== "string" || typeof flags.cmd !== "string") throw new Error("--cases FILE and --cmd 'COMMAND' are required; the command reads the case from $PR_PROOF_INPUT");
  const cases = JSON.parse(readFileSync(flags.cases, "utf8"));
  const timeoutMs = Number(flags.timeout ?? 120) * 1000;
  const baseDir = mkdtempSync(join(tmpdir(), "pr-proof-base-"));
  git(["worktree", "add", "--detach", baseDir, base], { cwd: root });
  try {
    if (existsSync(join(root, "node_modules")) && !existsSync(join(baseDir, "node_modules"))) symlinkSync(join(root, "node_modules"), join(baseDir, "node_modules"));
    const head = git(["rev-parse", "--short", "HEAD"], { cwd: root }).trim();
    const baseShort = base.slice(0, 7);
    const rows = cases.map((c) => {
      const label = c.control ? `Control: ${c.input}` : c.input;
      return `| ${cellText(label)} | ${cellText(runCase(baseDir, flags.cmd, c.input, timeoutMs))} | ${cellText(runCase(root, flags.cmd, c.input, timeoutMs))} |`;
    });
    return `| Input (verbatim) | Base \`${baseShort}\` | This branch \`${head}\` |\n|---|---|---|\n${rows.join("\n")}\n`;
  } finally {
    git(["worktree", "remove", "--force", baseDir], { cwd: root });
  }
}

async function matrixTable(base, root, flags) {
  if (typeof flags.spec !== "string") throw new Error("--spec FILE is required: variants, groups of cases and the command that runs one case");
  const head = git(["rev-parse", "--short", "HEAD"], { cwd: root }).trim();
  const headDir = typeof flags["head-dir"] === "string" ? resolve(flags["head-dir"]) : root;
  const run = (baseDir) => runMatrix({
    specPath: flags.spec,
    baseDir,
    headDir,
    baseLabel: base.slice(0, 7),
    headLabel: head,
    parallel: Number(flags.parallel ?? 4),
    timeoutMs: Number(flags.timeout ?? 180) * 1000,
    jsonPath: typeof flags.json === "string" ? flags.json : undefined
  });
  if (typeof flags["base-dir"] === "string") return run(resolve(flags["base-dir"]));
  const baseDir = mkdtempSync(join(tmpdir(), "pr-proof-base-"));
  git(["worktree", "add", "--detach", baseDir, base], { cwd: root });
  try {
    if (typeof flags.prepare === "string") {
      for (const dir of [baseDir, headDir]) {
        if (spawnSync("bash", ["-c", flags.prepare], { cwd: dir, stdio: "inherit" }).status !== 0) throw new Error(`--prepare failed in ${dir}`);
      }
    }
    return await run(baseDir);
  } finally {
    git(["worktree", "remove", "--force", baseDir], { cwd: root });
  }
}

const SPEC_TEMPLATE = `## Before and after

| Before (base \`{{sha}}\`) | After (this branch) |
|---|---|
| ![before]({{real screenshot from the base commit}}) | ![after]({{real screenshot from this branch}}) |
| {{one sentence: what it did before}} | {{one sentence: what it does now}} |

{{What is pixel-identical or different. Link to a short recording.}}
{{If nothing is visible, replace the screenshots with a line starting "Nonvisual:" and a concrete text comparison.}}

## Outcome

{{2 to 4 plain sentences: what the user saw before, and sees now. No file names.}}

**Outcome:** {{one line with measured numbers}}

## What changes for you

| You do | Base | This PR |
|---|---|---|
| {{something a user does or says, in their words}} | {{what happened before}} | {{what happens now}} |
| {{a case where nothing should change}} | {{what happens}} | {{same}} |

{{One line on where the change does not apply (other platforms, flags, modes).}}

## What changed

**1. {{First capability}}**
- {{Bullet under 30 words, one idea.}}
- **Behavior change:** {{only if behavior differs on purpose.}}

## Live results

{{Run the real thing. For anything with a prompt, model or CLI, run: pr-proof runs --cases cases.json --cmd 'COMMAND reading $PR_PROOF_INPUT' and paste the table here: input verbatim, base output, branch output, plus a control row.}}

| Run | Command | Base | This branch |
|---|---|---|---|

{{Fresh-profile matrix: write matrix.json (variants such as models, browsers, viewports; groups of cases that should change and cases that must not), run: pr-proof matrix --spec matrix.json, and paste the counts table here with one sentence on how many runs and from what state.}}

## Infographic

{{Optional, only when a picture explains it better than the tables. Write infographic.json, run: pr-proof infographic --spec infographic.json, then embed the image from pr-proof evidence. Delete this section if it adds nothing.}}

## Not covered

- {{What you did not test, and why.}}

## Cost surface

- {{Performance, size, tokens or CI time, measured. Or say it was not measured.}}

## Tests

- **Red on base:** {{new tests that fail before the change}} or **Green on base:** {{refactor guards that pass on both}}
- {{Union run: command and counts.}}
`;

function composeBody({ base, root, config, spec, repo }) {
  const result = runCheck(base, root, config);
  const diag = renderDiagrams(base, root, config);
  const parts = [];
  const architecture = [];
  const hasMapImages = existsSync(join(root, ".pr-proof", "floorplan-overview.png"));
  if (hasMapImages && diag.arch.mermaid) {
    const overview = floorplanImageUrl(root, "floorplan-overview.png", repo);
    const recent = floorplanImageUrl(root, "floorplan-recent.png", repo);
    architecture.push(`## Architecture impact\n\n![floorplan overview, changed parts tagged](${overview})\n\nThe whole map. Parts this PR touches show a green "+N changed" tag.\n\n![floorplan recent work board](${recent})\n\nThe floorplan's Recent work board for this PR: the cards it changed or added. Open the live map with \`node floorplan/serve.mjs\`.`);
  } else if (diag.arch.mermaid) {
    const legend = "Yellow nodes changed in this PR, grey nodes are their direct neighbours in the floorplan, and red marks changed files the floorplan does not cover.";
    const flows = (diag.arch.touchedFlows ?? []).map((flow) => `- **${flow.title}**: ${flow.description}`).join("\n");
    architecture.push(`## Architecture impact\n\n\`\`\`mermaid\n${diag.arch.mermaid}\n\`\`\`\n\n${legend}${flows ? `\n\nUser flows this PR touches:\n\n${flows}` : ""}`);
  } else {
    architecture.push("## Architecture impact\n\nNo floorplan in this repo, so there is no architecture map to draw. See the code delta below.\n\n```mermaid\nflowchart LR\n  none[\"no floorplan\"]\n```");
  }
  const specText = spec.trim();
  const anchor = /^##\s+What changes for you\b/m.test(specText) ? "What changes for you" : "Outcome";
  const outcomeAt = specText.search(new RegExp(`^##\\s+${anchor}\\b`, "m"));
  const afterOutcome = outcomeAt === -1 ? -1 : specText.slice(outcomeAt).search(new RegExp(`^##\\s+(?!${anchor}\\b)`, "m"));
  if (afterOutcome === -1) parts.push(specText, ...architecture);
  else {
    const cut = outcomeAt + afterOutcome;
    parts.push(specText.slice(0, cut).trim(), ...architecture, specText.slice(cut).trim());
  }
  const promptSurface = promptSurfaceSection(base, root, result.files, config);
  if (promptSurface) parts.push(promptSurface);
  parts.push(diag.delta ? `## Code delta\n\n\`\`\`mermaid\n${diag.delta}\n\`\`\`\n\nGreen files are new, yellow are modified, red are deleted, and grey are existing files the new code imports.` : "## Code delta\n\nNo source files changed.\n\n```mermaid\nflowchart LR\n  none[\"no source changes\"]\n```");
  parts.push("## Rules check\n\n" + rulesTable(result, diag));
  const fileLines = result.files.map((f) => `- \`${f.path}\` ${f.status === "A" ? "(new)" : f.status === "D" ? "(deleted)" : ""} +${f.add} -${f.del}`).join("\n");
  parts.push(`<details><summary>Changed files (${result.files.length})</summary>\n\n${fileLines}\n\n</details>`);
  return parts.join("\n\n") + "\n";
}

function githubRepo(flag) {
  if (typeof flag === "string") return flag;
  try { return JSON.parse(execFileSync("gh", ["repo", "view", "--json", "nameWithOwner"], { encoding: "utf8" })).nameWithOwner; } catch { return null; }
}

function commentViolations(path, text, skip = new Set()) {
  return commentsIn(path, text)
    .filter((c) => !isAllowedComment(c.text, c.startLine) && !skip.has(c.text.trim()))
    .map((c) => ({ line: c.startLine, text: c.text.split("\n")[0].trim().slice(0, 100) }));
}

function lintComments(files, flags) {
  const found = [];
  if (flags.staged) {
    const added = addedLines(null, true);
    const root = repoRoot();
    for (const [path, lines] of added) {
      const full = join(root, path);
      if (!lines.size || !existsSync(full)) continue;
      for (const c of commentsIn(path, readFileSync(full, "utf8"))) {
        let touched = null;
        for (let l = c.startLine; l <= c.endLine; l++) if (lines.has(l)) { touched = l; break; }
        if (touched !== null && !isAllowedComment(c.text, c.startLine)) found.push({ path, line: touched, text: c.text.split("\n")[0].trim().slice(0, 100) });
      }
    }
  } else {
    for (const file of files) {
      if (!existsSync(file)) continue;
      for (const v of commentViolations(file, readFileSync(file, "utf8"))) found.push({ path: file, ...v });
    }
  }
  if (!found.length) { console.log("ok: no explanatory comments"); return 0; }
  console.error(`explanatory comments (${found.length}):\n` + found.map((v) => `  ${v.path}:${v.line}  ${v.text}`).join("\n"));
  return 1;
}

async function hookComments() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let call;
  try { call = JSON.parse(raw); } catch { return 0; }
  const input = call.tool_input ?? {};
  const path = input.file_path ?? "";
  if (!path || !(CODE_EXT.has(extOf(path)) || SCRIPT_EXT[extOf(path)] || MARKUP_COMMENT_EXT.has(extOf(path)))) return 0;
  const edits = Array.isArray(input.edits) ? input.edits : [{ old_string: input.old_string ?? "", new_string: input.new_string ?? input.content ?? "" }];
  const found = [];
  for (const edit of edits) {
    const previous = new Set(commentsIn(path, edit.old_string ?? "").map((c) => c.text.trim()));
    found.push(...commentViolations(path, edit.new_string ?? "", previous));
  }
  if (!found.length) return 0;
  console.error(`Comments are banned (global rule 2). Remove these from ${path} and make the code say it instead (rename, extract, type, lint rule):\n` + found.map((v) => `  ${v.text}`).join("\n"));
  return 2;
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const { flags, rest } = parseArgs(argv);
  if (!command || command === "help" || flags.help) { console.log(USAGE); return 0; }
  if (command === "hook-comments") return hookComments();
  if (command === "template") { process.stdout.write(SPEC_TEMPLATE); return 0; }
  if (command === "lint-comments") return lintComments(rest, flags);
  const root = repoRoot();
  const config = loadConfig(root);

  if (command === "evidence") {
    if (!rest.length) { console.error("give at least one file"); return 2; }
    const dir = join(root, ".pr-proof");
    mkdirSync(dir, { recursive: true });
    const repo = githubRepo(flags.repo);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    for (const file of rest) {
      const name = basename(file);
      copyFileSync(resolve(file), join(dir, name));
      const url = repo ? `https://github.com/${repo}/blob/${branch}/.pr-proof/${name}?raw=true` : `.pr-proof/${name}`;
      console.log(/\.(webm|mp4|mov)$/i.test(name) ? `[${name}](${url})` : `![${name}](${url})`);
    }
    console.error("commit .pr-proof/ on this branch before opening the PR so the links resolve");
    return 0;
  }

  if (command === "install-ci") {
    const target = typeof flags.dir === "string" ? resolve(flags.dir) : root;
    for (const written of installCi(target)) console.log(`wrote ${written}`);
    console.log("next: commit these files, then install the Greptile GitHub app on this repo at https://app.greptile.com (Code Providers, GitHub Cloud, enable the repo). Drafts are reviewed because the config sets triggerOnDrafts.");
    return 0;
  }

  if (command === "infographic") {
    if (typeof flags.spec !== "string") { console.error("--spec FILE is required"); return 2; }
    const out = resolve(typeof flags.out === "string" ? flags.out : join(root, ".pr-proof", "infographic.png"));
    mkdirSync(dirname(out), { recursive: true });
    const htmlPath = join(mkdtempSync(join(tmpdir(), "pr-proof-infographic-")), "infographic.html");
    await renderInfographic({ spec: JSON.parse(readFileSync(flags.spec, "utf8")), htmlPath, outPath: out, playwrightUrl: pathToFileURL(PLAYWRIGHT).href, chromiumPath: CHROMIUM });
    console.log(out);
    return 0;
  }

  const base = resolveBase(flags.base);

  if (command === "matrix") {
    process.stdout.write(await matrixTable(base, root, flags));
    return 0;
  }

  if (command === "ci-comment") {
    const result = runCheck(base, root, config);
    const bodyProblems = checkBody(flags.body, promptFiles(result.files, config), config.requiredSections);
    const testIssue = testProblem(result, flags.body);
    const sha = typeof flags.sha === "string" ? flags.sha : git(["rev-parse", "HEAD"]).trim();
    const subject = git(["log", "-1", "--format=%s", "HEAD"]).trim().slice(0, 64);
    process.stdout.write(composeCiComment({
      sha,
      subject,
      runUrl: typeof flags["run-url"] === "string" ? flags["run-url"] : null,
      commitUrl: typeof flags["commit-url"] === "string" ? flags["commit-url"] : `https://github.com/commit/${sha}`,
      rules: { effects: result.effects, comments: result.comments, testIssue },
      bodyProblems,
      promptSection: promptSurfaceSection(base, root, result.files, config),
      diff: { files: result.files.length, add: result.files.reduce((n, f) => n + f.add, 0), del: result.files.reduce((n, f) => n + f.del, 0), e2e: result.e2eTests.length, unit: result.unitTests.length },
      sections: sectionsPresent(readFileSync(flags.body, "utf8"), config.requiredSections)
    }));
    return result.effects.length || result.comments.length || testIssue || bodyProblems.length ? 1 : 0;
  }

  if (command === "floorplan-map") return floorplanMap(base, root, flags);

  if (command === "prompt-surface") {
    const section = promptSurfaceSection(base, root, changedFiles(base), config);
    console.log(section ?? "No prompt files changed.");
    return 0;
  }

  if (command === "runs") {
    process.stdout.write(runsTable(base, root, flags));
    return 0;
  }

  if (command === "diagram") {
    const diag = renderDiagrams(base, root, config);
    console.log("## Architecture impact\n\n```mermaid\n" + (diag.arch.mermaid ?? "flowchart LR\n  none[\"no floorplan\"]") + "\n```\n");
    console.log("## Code delta\n\n```mermaid\n" + (diag.delta ?? "flowchart LR\n  none[\"no source changes\"]") + "\n```");
    return 0;
  }

  if (command === "check") {
    const result = runCheck(base, root, config);
    const bodyProblems = flags.body ? checkBody(flags.body, promptFiles(result.files, config), config.requiredSections) : [];
    const problems = printCheck(result, bodyProblems, testProblem(result, flags.body));
    if (problems.length) { console.error(problems.join("\n")); return 1; }
    console.log(`ok: ${result.files.length} files, no useEffect added, no explanatory comments added, e2e or integration coverage present${flags.body ? ", PR body has proof and diagrams" : ""}`);
    return 0;
  }

  if (command === "body") {
    if (typeof flags.spec !== "string") { console.error("--spec FILE is required: the agent-written part of the PR body"); return 2; }
    process.stdout.write(composeBody({ base, root, config, spec: readFileSync(flags.spec, "utf8"), repo: githubRepo(flags.repo) }));
    return 0;
  }

  if (command === "create") {
    if (typeof flags.title !== "string" || typeof flags.body !== "string") { console.error("--title TEXT and --body FILE are required"); return 2; }
    const result = runCheck(base, root, config);
    const problems = printCheck(result, checkBody(flags.body, promptFiles(result.files, config), config.requiredSections), testProblem(result, flags.body));
    if (problems.length) { console.error(problems.join("\n") + "\nno PR created"); return 1; }
    const args = ["pr", "create", "--draft", "--title", flags.title, "--body-file", flags.body];
    if (typeof flags["base-branch"] === "string") args.push("--base", flags["base-branch"]);
    if (flags["dry-run"]) { console.log("checks passed; dry run, would run: gh " + args.map((a) => JSON.stringify(a)).join(" ")); return 0; }
    return spawnSync("gh", args, { stdio: "inherit", env: { ...process.env, PR_PROOF: "1" } }).status ?? 1;
  }

  console.error(USAGE);
  return 2;
}

try { process.exit(await main()); } catch (error) { console.error(error.message); process.exit(2); }
