// Local stand-in for the processing service, so the Proceed journey can be walked end to end before the
// real one exists. It writes clearly labelled simulated records and points every short at one test clip.
// Refuses any database that isn't on this machine: simulated rows must never reach TigerData.
//
//   DATABASE_URL=postgres://you@127.0.0.1:5432/resurface_dev node scripts/dev-processor.mjs
//   Optional: PORT (8799), STEP_MS (2500), FAIL_IDS=<youtube id>,<youtube id> to simulate failures.

import { createServer } from "node:http";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error("dev-processor only runs against a local database (DATABASE_URL host 127.0.0.1 or localhost).");
  process.exit(1);
}

const sql = postgres(url, { max: 4 });
const PORT = Number(process.env.PORT ?? 8799);
const STEP = Number(process.env.STEP_MS ?? 2500);
const FAIL = new Set((process.env.FAIL_IDS ?? "").split(",").filter(Boolean));
const MEDIA = "r2:videos/dev/simulation/short.mp4";
const CAPTIONS = "r2:captions/dev/simulation/short.vtt";
const busy = new Set();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(id) {
  if (busy.has(id)) return;
  busy.add(id);
  try {
    let [unit] = await sql`UPDATE ingested_units SET status = 'running' WHERE id = ${id} AND status = 'pending' RETURNING source_url, status`;
    const videoId = async () => new URL((unit ?? (await sql`SELECT source_url FROM ingested_units WHERE id = ${id}`)[0]).source_url).searchParams.get("v");
    if (unit) {
      const vid = await videoId();
      console.log(`unit ${id} (${vid}): fetching`);
      await wait(STEP);
      if (FAIL.has(vid)) {
        await sql`UPDATE ingested_units SET status = 'failed', error = 'Simulated failure from the local dev processor.' WHERE id = ${id}`;
        return console.log(`unit ${id}: failed (simulated)`);
      }
      await sql`
        UPDATE ingested_units
        SET status = 'ready', title = ${`[Simulated] ${vid}`}, extraction_method = 'dev-processor',
            transcript = ${sql.json([{ simulated: true }])}, extracted_at = now()
        WHERE id = ${id}`;
    } else {
      // Already extracted (a reused import): digest only if nobody has yet. Digests are shared.
      [unit] = await sql`SELECT source_url, status FROM ingested_units WHERE id = ${id}`;
      if (unit?.status !== "ready") return;
      const [done] = await sql`SELECT 1 FROM artifacts WHERE ${id}::uuid = ANY (source_ids) AND ingestion_status <> 'failed'`;
      if (done) return;
    }
    const vid = await videoId();
    console.log(`unit ${id}: digesting`);
    await wait(STEP);

    const [artifact] = await sql`
      INSERT INTO artifacts (name, source_url, source_ids, sources, processed_text, category, selection_reason,
                             ingestion_status, processed_at)
      VALUES (${`[Simulated] Takeaway from ${vid}`}, ${unit.source_url}, ${sql.array([id], 2950)},
              ${sql.json([{ url: unit.source_url, title: `YouTube ${vid}` }])},
              'Simulated digest from the local dev processor.', 'Simulation',
              'Local dev processor output, not a real digest. The clip is a test pattern.',
              'ready', now())
      RETURNING id, version`;
    const [video] = await sql`
      INSERT INTO video_results (artifact_id, artifact_version, status)
      VALUES (${artifact.id}, ${artifact.version}, 'running') RETURNING id`;
    console.log(`unit ${id}: rendering`);
    await wait(STEP * 2);

    await sql`
      UPDATE video_results
      SET status = 'ready', media_ref = ${MEDIA}, caption_ref = ${CAPTIONS}, narration_ref = 'simulated',
          music_ref = 'simulated', music_provenance = 'test tone', duration_seconds = 12, updated_at = now()
      WHERE id = ${video.id}`;
    console.log(`unit ${id}: ready`);
  } catch (err) {
    console.error(`unit ${id}:`, err.message);
  } finally {
    busy.delete(id);
  }
}

// The contract says to sweep pending units too, so a missed request still gets picked up.
setInterval(async () => {
  const rows = await sql`SELECT id FROM ingested_units WHERE status = 'pending' ORDER BY created_at LIMIT 10`.catch(() => []);
  rows.forEach((r) => run(r.id));
}, 10_000);

createServer((req, res) => {
  if (req.method !== "POST") return res.writeHead(405).end();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch {}
    res.writeHead(202).end();
    (payload.unit_ids ?? []).forEach(run);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`dev-processor on http://127.0.0.1:${PORT}/process (simulated output)`));
