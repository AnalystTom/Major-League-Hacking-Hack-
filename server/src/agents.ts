// Where each coding agent looks for skills and project rules, and how a takeaway becomes a file there.

import type { Short } from "./shorts.js";

export type AgentId = "claude" | "codex" | "cursor" | "hermes";

type Agent = {
  name: string;
  skillPath: (slug: string) => string;
  /** Project-wide rules file, or null when the agent only reads skills. */
  rulesPath: string | null;
};

export const AGENTS: Record<AgentId, Agent> = {
  claude: { name: "Claude Code", skillPath: (s) => `.claude/skills/${s}/SKILL.md`, rulesPath: "CLAUDE.md" },
  codex: { name: "Codex", skillPath: (s) => `.agents/skills/${s}/SKILL.md`, rulesPath: "AGENTS.md" },
  cursor: { name: "Cursor", skillPath: (s) => `.cursor/rules/${s}.mdc`, rulesPath: ".cursor/rules/project.mdc" },
  hermes: { name: "Hermes", skillPath: (s) => `~/.hermes/skills/${s}/SKILL.md`, rulesPath: null },
};

export const isAgentId = (value: unknown): value is AgentId =>
  typeof value === "string" && Object.hasOwn(AGENTS, value);

export type Export = { agent: AgentId; path: string; content: string };

/** Renders a short as the file its agent reads: a SKILL.md, a Cursor rule, or a rules-file section. */
export function exportShort(short: Short, agentId: AgentId): Export {
  const agent = AGENTS[agentId];
  const asRule = short.kind === "rules" && agent.rulesPath !== null;
  const path = asRule ? agent.rulesPath! : agent.skillPath(short.slug);
  const source = `Source: ${short.source}, ${short.from}${short.url ? ` (${short.url})` : ""}`;

  if (asRule) {
    return { agent: agentId, path, content: `## ${short.takeaway}\n\n${short.why}\n\n${source}\n` };
  }

  const frontmatter =
    agentId === "cursor"
      ? `---\ndescription: ${short.takeaway}\nalwaysApply: false\n---`
      : `---\nname: ${short.slug}\ndescription: ${short.takeaway}\n---`;

  return {
    agent: agentId,
    path,
    content: `${frontmatter}\n\n# ${short.takeaway}\n\n${short.why}\n\n${source}\n`,
  };
}
