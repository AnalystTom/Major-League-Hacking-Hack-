import { readFile } from "node:fs/promises";
import pg from "pg";
import { createApi } from "./api.ts";
import { MemoryStore, PgStore } from "./store.ts";

const geminiKey = process.env.GEMINI_API_KEY;
if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const context = JSON.parse(await readFile(process.env.PROJECT_CONTEXT ?? "config/project-context.placeholder.json", "utf8"));
const port = Number(process.env.PORT ?? 8787);
const windowSeconds = process.env.WINDOW_SECONDS ? Number(process.env.WINDOW_SECONDS) : undefined;
createApi({ geminiKey, geminiModel: process.env.GEMINI_MODEL, windowSeconds, openaiKey: process.env.OPENAI_API_KEY, openaiModel: process.env.OPENAI_MODEL, store: pool ? new PgStore(pool) : new MemoryStore(), context })
  .listen(port, () => console.log(`import API on :${port}`));
