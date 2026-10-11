import { readFile } from "node:fs/promises";
import { z } from "zod";

const Context = z.object({
  name: z.string().trim().min(1),
  goal: z.string().nullable().default(null),
  facts: z.array(z.object({ fact: z.string().min(1), source: z.string().optional() })).default([]),
});

export async function readProjectContext(path: string | undefined) {
  if (!path) throw new Error("PROJECT_CONTEXT must point to a real project brief JSON file");
  return Context.parse(JSON.parse(await readFile(path, "utf8")));
}
