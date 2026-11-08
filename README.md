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

- **Shorts**: new video generation is paused (`SHORTS=off`); previously produced shorts remain. See the [processor flow](docs/proceed-and-media.md#the-processor).
- **Keep**: choosing which generated skills to keep is not live yet.
- **Skills**: concise source-grounded SKILL.md files for your coding agent; see the [skill contract](docs/project-actions-spec.md#workflow-3-processed-skill-and-codex-use).
- **Private reels**: sign in for your personal reel, or choose **View available reels & Skills** to browse the public catalogue at `/available`.
- **Source checking**: before installing, Resurface pulls the linked repo, release notes, and open issues so outdated tips (such as a deprecated flag) don't ship.
- **Reviewable installs**: skills, rules, and `AGENTS.md` sections land in your repo as a reviewable diff, each linked back to its original post or video.

## Supported sources

Individual pasted X, YouTube, and Substack links. Automatic bookmark and Watch Later import, and X/Google sign-in, are not live yet.

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

Task generation and agent-task handoffs are unavailable for now. Copy or download a skill from the Skills sheet.
API access and deduplication follow the [HTTP contract](docs/project-actions-spec.md#http-api); legacy output refreshes follow the [processor policy](docs/proceed-and-media.md#the-processor).
