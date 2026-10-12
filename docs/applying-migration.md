# D1 database and TigerData cutover

Accounts, sessions, imports, prompts, artifacts, outputs, tasks, handoffs and processing starts use Cloudflare D1.
The web Worker and processor Worker bind `DB` to `resurface-waitlist`
(`89d777a6-eb11-4feb-9484-6f555a3ba96e`). The waitlist table remains in that database.

Apply the schema from `web/`:

```sh
npm run db:migrate:local
npm run db:migrate:remote
```

`web/migrations/0002_application.sql` is the application schema. The PostgreSQL migrations in
`db/migrations/` are retained as historical source documentation; do not apply them to D1.
D1 stores UUIDs and UTC timestamps as text, JSON as validated JSON text, booleans as integers,
and processing start IDs as autoincrement integers. Artifact revisions remain immutable.

## Processor connection

The Node container cannot receive a D1 binding directly. The processor Worker handles
`POST /internal/d1` using its binding and `DB.batch()`, which runs each batch as one transaction.
It authenticates this route with `INGEST_TOKEN` and never wakes the container for database calls.
The container receives `D1_URL` and a `D1_TOKEN` derived from that token at startup. No Cloudflare
account API token or PostgreSQL credentials are passed to the container.

For a standalone Node processor, set `D1_URL` to the processor Worker's `/internal/d1` URL and
`D1_TOKEN` to its ingest token. Leave both unset only for ephemeral CLI/test runs.

## Existing TigerData records

1. Pause application mutations and processor requests/sweeps. Wait for `/health` to report `busy: 0`.
2. Export all public application tables in one repeatable-read, read-only PostgreSQL transaction
   as JSON `{ "users": [ ... ], ... }`. Keep the snapshot private: it contains password and session hashes.
3. Prepare and validate the import:

   ```sh
   node db/scripts/prepare-d1-import.mjs /private/path/source.json /private/path/import.json
   ```

   This checks every table and column, D1 row/statement limits, foreign keys, schema constraints and
   checksums. It outputs bound SQL statements so large agent briefs do not exceed SQL text limits.
4. Apply the D1 migrations and execute the prepared batches using the Cloudflare D1 API. The target
   application tables must be empty; never overwrite a populated target or ignore conflicts.
5. Read every target table back and compare every source column and checksum. Preserve source IDs,
   password/session hashes, timestamps, processing limits, review metadata and R2 references.
6. Deploy the D1 processor and web Worker, verify a fresh account in isolated headless Playwright,
   and confirm existing sessions, output/media reads and processing claims still work.
7. Remove `DATABASE_URL` from both Workers and resume processing. Keep TigerData and the private backup
   available for recovery until its removal is explicitly requested. Do not delete the source database.

Never put connection strings, tokens, password hashes or snapshots in Git or public evidence.
