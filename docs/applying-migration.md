# Applying the shared TigerData schema

The migration `db/migrations/001_shared_schema.sql` (spec: `docs/project-actions-spec.md`)
has **not been confirmed as applied**. The cloud sandbox that prepared it could not reach the
database (`kc5lnts1vn.vy2oiaal4n.tsdb.cloud.timescale.com:32440` timed out), so it
needs to be run from a machine with normal outbound network access.

Target: Tiger Cloud service `mlh-aie-hackathon` (id `kc5lnts1vn`, us-east-2).

## Prerequisites

- The [`tiger` CLI](https://docs.tigerdata.com) installed and logged in (`tiger auth login`).
- The current `main` branch checked out.

## Steps

Run from the repo root.

1. Confirm the service:

   ```
   tiger service list
   ```

   Expect `mlh-aie-hackathon` / `kc5lnts1vn` with status `READY`.

2. Test connectivity:

   ```
   tiger db test-connection --service-id kc5lnts1vn
   ```

   If this times out, your network blocks outbound TCP to port 32440. Try another
   network or ask the network admin to allow it.

3. For an empty database, apply the migrations in order (stops at the first error):

   ```
   tiger db connect --service-id kc5lnts1vn -- -v ON_ERROR_STOP=1 -f db/migrations/001_shared_schema.sql -f db/migrations/002_accounts.sql -f db/migrations/003_ready_feed.sql
   ```

4. Verify:

   ```
   tiger db connect --service-id kc5lnts1vn -- -c '\dt' -c '\dv'
   ```

   Expect these tables: `project_contexts`, `digestion_prompts`, `ingested_units`,
   `artifacts`, `artifact_exclusions`, `video_results`, `skill_results`,
   `action_items`, `handoffs`, `users`, `sessions`, `user_imports`, plus the `artifact_feed` view.
   Existing databases should receive only migrations not yet applied. `003_ready_feed.sql`
   removes manual approval gates without deleting historical metadata.

## If it fails

- Fix the SQL minimally in `db/migrations/001_shared_schema.sql`, commit, and push to
  the current integration branch.
- The initial migrations are not idempotent. Each runs in a transaction; after a
  failure, inspect the schema before retrying. Never drop existing tables to rerun it.
- Never paste connection strings or passwords into commits, issues or chat.
