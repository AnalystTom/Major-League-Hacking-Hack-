export const CI_MARKER = "<!-- pr-proof-ci-review-bot -->";

const REQUIRED_SECTIONS = ["Before and after", "Outcome", "What changes for you", "What changed", "Live results", "Not covered", "Cost surface", "Tests", "Architecture impact", "Code delta", "Rules check"];
const OPTIONAL_SECTIONS = ["Infographic", "Prompt surface"];

const bullet = (lines) => lines.map((line) => `- ${line}`).join("\n");

export function sectionsPresent(body, extraSections = []) {
  const headings = new Set([...body.matchAll(/^#{1,2}\s+(.+)$/gm)].map((m) => m[1].trim()));
  return {
    required: [...REQUIRED_SECTIONS, ...extraSections].map((name) => ({ name, present: headings.has(name) })),
    optional: OPTIONAL_SECTIONS.map((name) => ({ name, present: headings.has(name) }))
  };
}

export function composeCiComment({ sha, subject, runUrl, commitUrl, rules, bodyProblems, promptSection, diff, sections }) {
  const action = [];
  const job = runUrl ? ` · [View job](${runUrl})` : "";
  const ruleLines = [];
  if (rules.testIssue) ruleLines.push(rules.testIssue);
  if (rules.effects.length) ruleLines.push(`\`useEffect\` added outside the framework layer (${rules.effects.length}):\n${bullet(rules.effects.map((e) => `  \`${e.path}:${e.line}\` ${e.text}`))}`);
  if (rules.comments.length) ruleLines.push(`explanatory comments added (${rules.comments.length}):\n${bullet(rules.comments.map((c) => `  \`${c.path}:${c.line}\` ${c.text}`))}`);
  if (ruleLines.length) action.push(`### Rules broken${job}\n\n${bullet(ruleLines)}\n\n**How to fix:** fix the code, not the check. Comments go away by renaming or extracting. Behavior changes need an e2e journey that fails without the change.`);
  if (bodyProblems.length) action.push(`### PR body is missing proof${job}\n\n${bullet(bodyProblems)}\n\n**How to fix:** run \`pr-proof template\`, fill every section, then \`pr-proof body --spec\` and update the description.`);
  if (promptSection) action.push(`### Prompt surface changed${job}\n\nThis PR changes text a model reads, so every session that sends it behaves differently. Merging needs a reviewer who has read the diff below.\n\n${promptSection.replace(/^## Prompt surface\s*/, "")}`);

  const proofRows = [...sections.required.map((s) => `| ${s.name} | ${s.present ? "✅" : "❌"} |`), ...sections.optional.map((s) => `| ${s.name} (optional) | ${s.present ? "✅" : "➖"} |`)];
  const info = [
    `### What the PR body proves${job}\n\n| Section | Present |\n|---|---|\n${proofRows.join("\n")}`,
    `### Diff\n\n${diff.files} files, +${diff.add} -${diff.del}. ${diff.e2e} e2e or integration test file(s), ${diff.unit} unit test file(s) in the diff.`
  ];
  const status = action.length ? "## ⚠️ Action required" : "## ✅ Nothing to fix";
  return `${CI_MARKER}\n# pr-proof ci review\n\n<sub>ran on [${sha.slice(0, 7)}](${commitUrl}) — ${subject}</sub>\n\n${status}\n\n${action.length ? action.join("\n\n---\n\n") : "Rules, tests and PR body checks all pass."}\n\n---\n\n## ℹ️ Info\n\n${info.join("\n\n")}\n`;
}
