import { databaseFromEnv } from "../db.js";
import { digestAndStore, ingestLinks, reserveDigest } from "./pipeline.js";
import { MemoryStore, D1Store, type Store } from "./store.js";

const [request, ...links] = process.argv.slice(2);
if (!request || links.length === 0) { console.error('usage: npm run ingest -- "<request>" <url>...'); process.exit(2); }
const need = (k: string) => process.env[k] ?? (() => { throw new Error(`${k} is not set`); })();

const db = databaseFromEnv();
const store: Store = db ? new D1Store(db) : new MemoryStore();

const units = await ingestLinks(links, { geminiKey: need("GEMINI_API_KEY"), geminiModel: process.env.GEMINI_MODEL, nimbleKey: process.env.NIMBLE_API_KEY, windowSeconds: process.env.WINDOW_SECONDS ? Number(process.env.WINDOW_SECONDS) : undefined, store });
for (const u of units) console.log(`${u.status.padEnd(7)} ${u.sourceUrl} ${u.error ?? ""}`);
const ready = units.filter((u) => u.status === "ready");
const reserved = await reserveDigest(store, ready);
const d = await digestAndStore({ reservation: reserved.reservation, apiKey: need("OPENAI_API_KEY"), model: process.env.OPENAI_MODEL, maxOutputTokens: process.env.OPENAI_MAX_OUTPUT_TOKENS ? Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) : undefined, units: reserved.units, request, store });
if (d.storeError) console.error(`store error: ${d.storeError}`);
console.log(JSON.stringify({ digestion_prompt_id: d.promptId, ...d.result }, null, 2));
