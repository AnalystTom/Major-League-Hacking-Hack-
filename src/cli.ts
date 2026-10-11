import { readFile } from "node:fs/promises";
import pg from "pg";
import { ingestLinks } from "./pipeline.ts";
import { runDigestion } from "./digest/run.ts";
import { MemoryStore, PgStore, type Store } from "./store.ts";

// usage: node src/cli.ts "<categorization request>" <youtube-url>...
// env: GEMINI_API_KEY, OPENAI_API_KEY, optional DATABASE_URL (otherwise in-memory), PROJECT_CONTEXT (json path)
const [request, ...links] = process.argv.slice(2);
if (!request || links.length === 0) { console.error('usage: node src/cli.ts "<request>" <url>...'); process.exit(2); }
const need = (k: string) => process.env[k] ?? (() => { throw new Error(`${k} is not set`); })();

const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const store: Store = pool ? new PgStore(pool) : new MemoryStore();
const ctx = JSON.parse(await readFile(process.env.PROJECT_CONTEXT ?? "config/project-context.placeholder.json", "utf8"));

const units = await ingestLinks(links, { geminiKey: need("GEMINI_API_KEY"), geminiModel: process.env.GEMINI_MODEL, windowSeconds: process.env.WINDOW_SECONDS ? Number(process.env.WINDOW_SECONDS) : undefined, store });
for (const u of units) console.log(`${u.status.padEnd(7)} ${u.sourceUrl} ${u.error ?? ""}`);
const ready = units.filter((u) => u.status === "ready");
const digest = await runDigestion({ apiKey: need("OPENAI_API_KEY"), model: process.env.OPENAI_MODEL, units: ready, request, context: ctx });
await store.saveArtifacts(digest.artifacts, digest.exclusions, null);
console.log(JSON.stringify(digest, null, 2));
await pool?.end();
