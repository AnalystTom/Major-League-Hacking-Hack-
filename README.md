# Resurface

**You saved it. Your agent never saw it.**

Resurface turns the bookmarks, Watch Later videos, and conference talks you never got to into 30-second shorts. Keep the good ones, and they're installed in your coding agent as skills.

Live site: <https://resurface.thomasmann2001.workers.dev/>

Built at AI Engineer NYC 2026.

## What it does

- Takes saved content from YouTube, X, and Substack.
- Creates a 30-second short of the key part of each item.
- Lets you keep the useful ones, which become skills for your coding agent.
- Sends skills to Claude Code, Codex, Cursor, and Hermes.

## Features

- **Shorts**: burned narration subtitles stay in the vertical safe area. A single model judge scores grounding, clarity, usefulness, visuals and subtitles; every score must reach 4/5 with no recorded defects before upload. Each save becomes a short of the part worth keeping; see the [content selection rules](docs/project-actions-spec.md#filtering-and-digestion-prompt).
- **Keep**: mark items worth keeping. Keeps become skills, linked to their source (coming at launch).
- **Skills**: concise source-grounded SKILL.md files follow the skill-creator format, with when-to-use descriptions and short imperative steps.
- **Private reels**: personal imports and media require sign-in; browse explicitly public content under **View available reels & Skills**.
- **Source checking**: before installing, Resurface pulls the linked repo, release notes, and open issues so outdated tips (such as a deprecated flag) don't ship.
- **Reviewable installs**: skills, rules, and `AGENTS.md` sections land in your repo as a reviewable diff, each linked back to its original post or video.

## Supported sources

X bookmarks, YouTube playlists and videos, GitHub stars, newsletters, Substack, conference talks, and single pasted links.

## How it works

1. **Connect what you've saved**: import X bookmarks, YouTube playlists, GitHub stars, newsletters, and conference talks, or paste single links.
2. **Watch a short for each one**: each item becomes a 30-second short. Copy it or send it to your agents.
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

Personal reels use authenticated `/api/feed` and `/api/skills`; the anonymous catalogue at `/available` uses `?scope=public`.
Only artifacts with a team-assigned `video_results.feed_order` are public. New imports are private by default.
R2 media requests enforce the same ownership and quality checks as the feed, and are never publicly cached.
Historical duplicate rows and task records are preserved. Duplicate sources are hidden in lists; identical source-set digests are reused at creation.
Task generation and agent-task handoffs are unavailable for now. Legacy shorts are held until the processor rerenders them with burned subtitles and a passing judge receipt.
