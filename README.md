# Resurface

**You saved it. Your agent never saw it.**

Resurface turns the X, YouTube, and Substack links you never got to into source-linked `SKILL.md` files for your coding agent.

Live site: <https://resurface.thomasmann2001.workers.dev/>

Built at AI Engineer NYC 2026.

## What it does

- Takes saved content from YouTube, X, and Substack.
- Accepts pasted individual links after email/password sign-in and turns each into a skill for your coding agent.
- Sends skills to Claude Code, Codex, Cursor, and Hermes.

## Features

- **Shorts**: release configuration enables video generation (`SHORTS=on`) for kept skills with an explicit video request. Deployment and a real-short check are still required before calling this live. See the [processor flow](docs/proceed-and-media.md#the-processor).
- **Keep**: choose which generated skills to keep; videos remain opt-in.
- **Skills**: concise source-grounded SKILL.md files for your coding agent; see the [skill contract](docs/project-actions-spec.md#workflow-3-processed-skill-and-codex-use).
- **Private reels**: sign in for your personal reel, or choose **View available reels & Skills** to browse the public catalogue at `/available`.
- **Source checking**: before installing, Resurface pulls the linked repo, release notes, and open issues so outdated tips (such as a deprecated flag) don't ship.
- **Reviewable installs**: skills, rules, and `AGENTS.md` sections land in your repo as a reviewable diff, each linked back to its original post or video.

## Supported sources

Individual pasted X, YouTube, and Substack links. Automatic Watch Later import and Google sign-in are not live yet. X sign-in with bookmark import is built but stays off until the operator enables it; see [X sign-in and bookmark import](docs/x-bookmarks.md).

## How it works

1. **Paste what you've saved**: add individual X, YouTube, or Substack links.
2. **Get a skill for each one**: copy or download it for your agent.
3. **Check it against today's docs**: Resurface verifies content against current sources before installing.
4. **Install it where your agent looks**: skills, rules, and `AGENTS.md` sections are added to your repo as a reviewable diff.

## Repository layout

| Path | Contents |
| --- | --- |
| `web/` | Landing site and waitlist (Cloudflare Worker + D1) |
| `server/` | API server (Hono, Postgres) with ingest and handoff CLIs |
| `db/` | Database migrations |
| `deploy/` | Deployment assets, including the processor |
| `docs/` | Specs and notes |

## Development

Web (requires Node and Wrangler):

```sh
npm install --prefix web
npm run dev --prefix web
npm test --prefix web
```

Server (requires Node >= 22):

```sh
npm install --prefix server
npm run dev --prefix server
npm test --prefix server
```

Getting started is free: create an account at the live site.
For import reuse and refreshing older X reads, see the [import rules](docs/project-actions-spec.md#http-api).

Release operators: see [go-live, cost limits and rollback](docs/go-live.md). The pre-launch Basic-auth gate stays until the captain authorizes opening it.

Task generation and agent-task handoffs are unavailable for now. Copy or download a skill from the Skills sheet.
API access and deduplication follow the [HTTP contract](docs/project-actions-spec.md#http-api); legacy output refreshes follow the [processor policy](docs/proceed-and-media.md#the-processor).
