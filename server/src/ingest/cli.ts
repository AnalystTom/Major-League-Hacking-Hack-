import pg from "pg";
import { digestAndStore, ingestLinks } from "./pipeline.js";
import { MemoryStore, PgStore, type Store } from "./store.js";

// usage: npm run ingest -- "<categorization request>" <youtube-url>...
// env: GEMINI_API_KEY, OPENAI_API_KEY, optional DATABASE_URL (otherwise in-memory)
const [request, ...links] = process.argv.slice(2);
if (!request || links.length === 0) { console.error('usage: npm run ingest -- "<request>" <url>...'); process.exit(2); }
const need = (k: string) => process.env[k] ?? (() => { throw new Error(`${k} is not set`); })();

const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const store: Store = pool ? new PgStore(pool) : new MemoryStore();

const units = await ingestLinks(links, { geminiKey: need("GEMINI_API_KEY"), geminiModel: process.env.GEMINI_MODEL, windowSeconds: process.env.WINDOW_SECONDS ? Number(process.env.WINDOW_SECONDS) : undefined, store });
for (const u of units) console.log(`${u.status.padEnd(7)} ${u.sourceUrl} ${u.error ?? ""}`);
const ready = units.filter((u) => u.status === "ready");
const d = await digestAndStore({ apiKey: need("OPENAI_API_KEY"), model: process.env.OPENAI_MODEL, maxOutputTokens: process.env.OPENAI_MAX_OUTPUT_TOKENS ? Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) : undefined, units: ready, request, store });
if (d.storeError) console.error(`store error: ${d.storeError}`);
console.log(JSON.stringify({ digestion_prompt_id: d.promptId, ...d.result }, null, 2));
await pool?.end();
