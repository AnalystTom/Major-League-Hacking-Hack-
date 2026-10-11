import { readFile } from "node:fs/promises";
import pg from "pg";
import { createApi } from "./api.ts";
import { MemoryStore, PgStore } from "./store.ts";

const geminiKey = process.env.GEMINI_API_KEY;
if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const context = JSON.parse(await readFile(process.env.PROJECT_CONTEXT ?? "config/project-context.placeholder.json", "utf8"));
const port = Number(process.env.PORT ?? 8787);
createApi({ geminiKey, anthropicKey: process.env.ANTHROPIC_API_KEY, store: pool ? new PgStore(pool) : new MemoryStore(), context })
  .listen(port, () => console.log(`import API on :${port}`));
