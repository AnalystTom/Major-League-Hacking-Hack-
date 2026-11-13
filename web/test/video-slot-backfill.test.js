import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sql = (f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");

// Builds the pre-0007 schema, seeds one user per video history, then runs 0007's backfill.
function backfill(users) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const f of ["0002_application.sql", "0003_video_duration.sql", "0005_skill_choices.sql"]) db.exec(sql(f));
  let n = 0;
  for (const [name, videos] of Object.entries(users)) {
    db.prepare("INSERT INTO users(id,email,password_hash) VALUES(?,?,'x')").run(name, `${name.toLowerCase()}@example.test`);
    for (const { status, requested = 1, attempts = 0 } of videos) {
      const unit = `unit-${++n}`, art = `art-${n}`;
      db.prepare("INSERT INTO ingested_units(id,submitted_url,source_url,status,transcript) VALUES(?,?,?,'ready','{}')").run(unit, "t", `https://x.com/i/status/${n}`);
      db.prepare("INSERT INTO user_imports(user_id,unit_id) VALUES(?,?)").run(name, unit);
      db.prepare("INSERT INTO artifacts(id,name,source_url,source_ids) VALUES(?,?,?,?)").run(art, "a", `https://x.com/i/status/${n}`, JSON.stringify([unit]));
      db.prepare("INSERT INTO user_skill_choices(user_id,artifact_id,artifact_version,kept,video_requested) VALUES(?,?,1,1,?)").run(name, art, requested);
      if (status) {
        const ready = status === "ready";
        db.prepare("INSERT INTO video_results(artifact_id,artifact_version,status,attempts,media_ref,caption_ref,narration_ref,duration_seconds) VALUES(?,1,?,?,?,?,?,?)")
          .run(art, status, attempts, ready ? "m" : null, ready ? "c" : null, ready ? "n" : null, ready ? 20 : null);
      }
    }
  }
  db.exec(sql("0007_video_limits.sql"));
  return {
    db,
    slots: Object.fromEntries(db.prepare("SELECT user_id,artifact_id FROM user_video_requests").all().map((r) => [r.user_id, r.artifact_id])),
  };
}

test("0007 backfill: a failed video does not use the slot; ready, running and queued ones do", () => {
  const { db, slots } = backfill({
    onlyFailed: [{ status: "failed", attempts: 3 }],
    failedRetrying: [{ status: "failed", attempts: 1 }],
    ready: [{ status: "ready" }],
    running: [{ status: "running", attempts: 1 }],
    queued: [{ status: null }],
    failedThenReady: [{ status: "failed", attempts: 3 }, { status: "ready" }],
    readyThenFailed: [{ status: "ready" }, { status: "failed", attempts: 3 }],
    none: [],
  });
  assert.deepEqual(Object.keys(slots).sort(), ["failedThenReady", "queued", "ready", "readyThenFailed", "running"]);
  // The ready video wins over the failed one regardless of order.
  for (const u of ["failedThenReady", "readyThenFailed"]) {
    assert.equal(db.prepare("SELECT v.status FROM video_results v WHERE v.artifact_id=?").get(slots[u]).status, "ready");
  }
  // A failed-only user's request flag is cleared so they can ask for their one video again.
  for (const u of ["onlyFailed", "failedRetrying"]) {
    assert.equal(db.prepare("SELECT count(*) c FROM user_skill_choices WHERE user_id=? AND video_requested=1").get(u).c, 0);
  }
  assert.equal(db.prepare("SELECT count(*) c FROM video_results").get().c, 8, "no video row is deleted");
  db.close();
});
