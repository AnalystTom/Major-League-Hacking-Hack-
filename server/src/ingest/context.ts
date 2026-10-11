import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Project } from "./types.js";

// The shape the web Worker sends as `project`; id/version stay null for a local brief that isn't a saved project_contexts row.
const Context = z.object({
  id: z.string().uuid().nullable().default(null),
  version: z.number().int().min(1).nullable().default(null),
  name: z.string().trim().min(1),
  goal: z.string().nullable().default(null),
  tools: z.array(z.string().min(1)).default([]),
  agents: z.array(z.string().min(1)).default([]),
});

export async function readProjectContext(path: string | undefined): Promise<Project> {
  if (!path) throw new Error("PROJECT_CONTEXT must point to a real project brief JSON file");
  return Context.parse(JSON.parse(await readFile(path, "utf8")));
}
