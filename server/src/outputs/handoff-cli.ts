// Runs the whole text path for a few links and writes what each step produced:
// extraction -> Digestion Prompt artifacts -> one concise skill per artifact. Task handoffs are paused.
//
// usage: npm run handoff -- [--out <dir>] <youtube-url>...
// env: GEMINI_API_KEY, OPENAI_API_KEY; optional D1_URL and D1_TOKEN (also stores units, artifacts and skills), DIGESTION_REQUEST.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { databaseFromEnv } from "../db.js";
import { DEFAULT_CATEGORIZATION_REQUEST } from "../ingest/digest/prompt.js";
import { digestAndStore, ingestLinks } from "../ingest/pipeline.js";
import { MemoryStore, D1Store, type Store } from "../ingest/store.js";
import type { StoredArtifact } from "../ingest/types.js";
import { type HandoffSkill } from "./handoff.js";
import { D1HandoffStore, rowToSkill, uniqueSlugs } from "./handoff-store.js";
import { generateSkill } from "./skills.js";
import { D1OutputStore } from "./store.js";
import type { ReadyArtifact } from "./types.js";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : `handoff-run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const links = args;
if (links.length === 0) { console.error("usage: npm run handoff -- [--out <dir>] <youtube-url>..."); process.exit(2); }
const need = (k: string) => process.env[k] || (() => { throw new Error(`${k} is not set`); })();
const geminiKey = need("GEMINI_API_KEY");
const openaiKey = need("OPENAI_API_KEY");
const model = process.env.OPENAI_MODEL;

const db = databaseFromEnv();
const store: Store = db ? new D1Store(db) : new MemoryStore();
const write = async (path: string, data: unknown) => {
  await mkdir(join(out, path, ".."), { recursive: true });
  await writeFile(join(out, path), typeof data === "string" ? data : JSON.stringify(data, null, 2));
};
const step = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

step(`extracting ${links.length} link(s)`);
const units = await ingestLinks(links, { geminiKey, geminiModel: process.env.GEMINI_MODEL, store,
  windowSeconds: process.env.WINDOW_SECONDS ? Number(process.env.WINDOW_SECONDS) : undefined });
for (const u of units) step(`  ${u.status.padEnd(7)} ${u.title ?? u.sourceUrl} ${u.error ?? ""}`);
await write("1-units.json", units);
const ready = units.filter((u) => u.status === "ready");
if (!ready.length) throw new Error("no link was extracted");

step(`digesting ${ready.length} unit(s)`);
const d = await digestAndStore({ apiKey: openaiKey, model, units: ready, request: process.env.DIGESTION_REQUEST ?? DEFAULT_CATEGORIZATION_REQUEST, store });
if (d.storeError) throw new Error(`could not store the digest: ${d.storeError}`);
await write("2-digest.json", d.result);
const artifacts = (d.stored ?? []) as StoredArtifact[];
step(`  ${artifacts.length} artifact(s), ${d.result.exclusions.length} exclusion(s)`);
for (const a of artifacts) step(`  - ${a.name} [${a.category}] from ${a.source_ids.length} source(s)`);
if (!artifacts.length) throw new Error("the digest selected nothing; see 2-digest.json for the exclusions");

step("writing a skill per artifact");
const outputs = db ? new D1OutputStore(db) : null;
const titles = new Map(units.map((u) => [u.id, u.title]));
const skills: HandoffSkill[] = [];
const skillIds: string[] = [];
for (const a of artifacts) {
  const ra: ReadyArtifact = {
    id: a.id, version: a.version, name: a.name, category: a.category || null, processed_text: a.processed_text,
    selection_reason: a.selection_reason || null, source_ids: a.source_ids,
    sources: a.sources.map((s) => ({ url: s.url, title: s.title ?? null })), evidence: a.evidence,
  };
  const claim = outputs ? await outputs.claim("skill", ra) : null;
  try {
    const g = await generateSkill(ra, { apiKey: openaiKey, model });
    if (outputs && claim) { await outputs.finishSkill(claim, g); skillIds.push(claim.id); }
    skills.push(rowToSkill({
      id: claim?.id ?? a.id, skill_markdown: g.skill_markdown, artifact_name: a.name, category: a.category, sources: a.sources,
      evidence: a.evidence, unit_titles: Object.fromEntries(a.source_ids.map((id) => [id, titles.get(id) ?? null])), action_items: g.action_items,
    }));
    step(`  ready: ${skills.at(-1)!.slug}`);
  } catch (e) {
    if (outputs && claim) await outputs.fail("skill", claim, (e as Error).message);
    step(`  failed for "${a.name}": ${(e as Error).message}`);
  }
}
if (!skills.length) throw new Error("no skill was written");
// Read back what the processor route would read, so the handoff runs on the stored rows when there is a database.
const selected = db ? await new D1HandoffStore(db).loadSkills(skillIds) : uniqueSlugs(skills);
for (const s of selected) await write(`3-skills/${s.slug}/SKILL.md`, s.skill_markdown);
await write("3-skills/skills.json", selected);

step(`done: ${out}/3-skills/`);
