# Motion workstream boundary

## Current integration baseline (PR #2)

PR #2 was pulled locally at `181c426`. Its `web/`, `server/`, and `db/`
contracts supersede the historical assumptions below. Use `src/ingestion.ts`
to adapt ready artifacts plus explicit source-unit records. The shared feed
uses processing readiness rather than manual approval. The polling worker now
implements audio, local/cloud R2 delivery, and `video_results` persistence.
Database and cloud R2 verification still require credentials; see README.md and
docs/local-testing.md for the verified boundary. Do not describe fixtures as
real ingestion output.

## Historical implementation notes

Inspected main f893055, the historical `origin/codex/v0-spec:docs/v0-spec.md`, and the canonical `docs/project-actions-spec.md`. No application, package manager, shared schemas, motion implementation, AGENTS.md, or active hooks exist in this checkout. Remote heads checked; another detached Kilo worktree is left untouched. Work is isolated on `codex/motion-shorts`.

Own only this package. Do not change ingestion, TigerData migrations, skills, Cloudflare, waitlist, or feed UI. The adapter accepts proposed artifact names (`id`, `version`, `name`, `processed_text`, dynamic `category`, `sources`, `source_ids`, `evidence`, ready/approved states); it is a proposed boundary, not a claim of team agreement.

Plan: render the same 12-second feedback loop in Motion Canvas and Remotion; inspect frames and measured outputs; select an operational renderer provisionally while Opus access is missing. Implement strict evidence and animation schemas, staged Opus generation, trusted geometry/timeline rendering, durable local jobs and artifacts, captions/QA, human approval, and a local HTTP feed/media boundary. Add a distinct orchestration fixture and real render integration tests. No arbitrary generated code will execute.

Live Anthropic verification is blocked until ANTHROPIC_API_KEY is configured. Fixtures will never be represented as Opus output or published as verified content. Current official model docs confirm `claude-opus-5-5` (2026-10-11). No silent model fallback. Canonical v0 requires voice/music for publication; silent visual development previews remain allowed by the assignment.
