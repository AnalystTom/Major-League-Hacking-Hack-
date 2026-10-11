// The user's project brief: what they're building, their stack and tools, and the coding agents they
// use. Saved as a new project_contexts version each time, so results stay tied to the brief they used.

export const AGENTS = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor", hermes: "Hermes" };

const clean = (s, max) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ").slice(0, max) : "");

export function parseProject(body) {
  const name = clean(body?.name, 80);
  if (!name) return { ok: false, error: "Give your project a name." };
  const goal = clean(body?.goal, 500);
  const rawTools = Array.isArray(body?.tools) ? body.tools : typeof body?.tools === "string" ? body.tools.split(",") : [];
  const tools = [...new Set(rawTools.map((t) => clean(t, 40)).filter(Boolean))].slice(0, 20);
  const agents = Array.isArray(body?.agents) ? [...new Set(body.agents.filter((a) => Object.hasOwn(AGENTS, a)))] : [];
  return { ok: true, value: { name, goal: goal || null, tools, agents } };
}

/** Facts in the shape project_contexts expects: [{ kind, fact, source }]. */
export const toFacts = ({ tools, agents }) => [
  ...tools.map((t) => ({ kind: "tool", fact: t, source: "onboarding" })),
  ...agents.map((a) => ({ kind: "agent", fact: AGENTS[a], id: a, source: "onboarding" })),
];

export function fromRow(row) {
  if (!row) return null;
  const facts = row.facts ?? [];
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    goal: row.goal,
    tools: facts.filter((f) => f.kind === "tool").map((f) => f.fact),
    agents: facts.filter((f) => f.kind === "agent").map((f) => f.id),
  };
}

/** Writes the next version of the user's brief and makes it current. */
export async function saveProject(sql, user, project) {
  return sql.begin(async (tx) => {
    const [row] = user.project_context_id
      ? await tx`
          INSERT INTO project_contexts (id, version, name, goal, facts)
          SELECT ${user.project_context_id}, COALESCE(MAX(version), 0) + 1, ${project.name}, ${project.goal}, ${tx.json(toFacts(project))}
          FROM project_contexts WHERE id = ${user.project_context_id}
          RETURNING id, version, name, goal, facts`
      : await tx`
          INSERT INTO project_contexts (version, name, goal, facts)
          VALUES (1, ${project.name}, ${project.goal}, ${tx.json(toFacts(project))})
          RETURNING id, version, name, goal, facts`;
    await tx`UPDATE users SET project_context_id = ${row.id} WHERE id = ${user.id}`;
    return fromRow(row);
  });
}

export async function readProject(sql, user) {
  if (!user.project_context_id) return null;
  const [row] = await sql`
    SELECT id, version, name, goal, facts FROM project_contexts
    WHERE id = ${user.project_context_id} ORDER BY version DESC LIMIT 1`;
  return fromRow(row);
}
