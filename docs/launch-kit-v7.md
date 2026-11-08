# Resurface v7 launch kit

Drafts only. Nothing has been posted or deployed by this change.

## Claims as of 8 November 2026

The current product accepts pasted individual X, YouTube and Substack links after email/password signup or sign-in. It produces source-linked SKILL.md files for coding agents, with copy/download support. The live audit verified anonymous gates and public empty states, but did not verify a successful authenticated generation end to end. Recheck that journey before publishing launch claims.

New video generation is paused (`SHORTS=off`). The v7 film includes previously produced video examples; accompany it with that disclosure. Do not promise new narrated clips, automatic bookmark/watch-later import, X/Google sign-in, skill retention selection or video opt-in until those features are deployed and verified. No launch date or availability of those features is implied here.

## Draft X post

You saved the link. Give the idea to your coding agent.

Resurface turns pasted X, YouTube and Substack links into source-linked SKILL.md files for Claude Code, Codex, Cursor and Hermes.

https://resurface.thomasmann2001.workers.dev/

## Draft video attachment copy

Resurface in 26 seconds: saved links become agent skills. The film also shows previously produced shorts; new video generation is currently paused.

Paste individual links after signing in: https://resurface.thomasmann2001.workers.dev/

## Draft longer announcement

I built Resurface for the posts and videos I saved but never returned to.

Sign in, paste individual X, YouTube or Substack links, and turn their ideas into source-linked SKILL.md files. Copy or download the skills for Claude Code, Codex, Cursor or Hermes. Review generated skills before using them.

The attached v7 film includes earlier short-video examples. New video generation is currently paused. Collection import and social sign-in are not part of this release.

Try it: https://resurface.thomasmann2001.workers.dev/

## Publication assets and edit notes

- Landing film: [`web/public/hero-v7.mp4`](../web/public/hero-v7.mp4), H.264/AAC, 1280×720, 26.005 seconds, 3,815,063 bytes, fast-start MP4. Native browser controls; no autoplay. Download from `/hero-v7.mp4` after deployment.
- Poster: [`web/public/hero-v7-poster.jpg`](../web/public/hero-v7-poster.jpg), extracted at 2 seconds from that web encode.
- Accessible text: [`web/public/launch-v7-transcript.html`](../web/public/launch-v7-transcript.html), visual transcript of the film's text and examples, with music/effects noted. The film has no voiceover; its embedded explainers are animated visuals.
- Social card: [`web/public/og-launch-v7.jpg`](../web/public/og-launch-v7.jpg), 1200×630 JPEG. Text-only brand artwork, no invented usage figures. Landing OG and Twitter image URLs target the current workers.dev origin. Update those absolute URLs if the canonical host changes.
- Landscape master, read-only: `/home/russki/Major-League-Hacking-Hack-/calibration/trials/launch-video-v2/launch/out/hero-v7.mp4`, 1920×1080, 13,700,518 bytes. SHA-256 `521b2fa677adf02b454f25d336e182fcefd0d2d2f67a42b6db5491752075af0d`.
- **Vertical social master, outside this repo:** `/home/russki/Major-League-Hacking-Hack-/calibration/trials/launch-video-v2/launch/out/vertical-v7.mp4`, H.264/AAC, 1080×1920, 26.005 seconds, 12,351,144 bytes. SHA-256 `0cf50480669fdd0566987ba639adeabccdcf3ea16b8788db5179226691dd8cab`. Use this local file for manual social uploads; it is intentionally not duplicated in git. Preserve the master.
- Editable Remotion source lives beside the masters at `.../launch/src/Film.tsx`. v7 removes the v6 Value scene and cuts from skills directly to the two phone previews; the music/effects mix is `.../launch/public/sfx/mix-v7.wav`. Source was read only during this work.

Web encode reproduction (run from repo root, using the read-only master as input):

```sh
ffmpeg -i /home/russki/Major-League-Hacking-Hack-/calibration/trials/launch-video-v2/launch/out/hero-v7.mp4 -vf scale=1280:-2 -c:v libx264 -preset fast -crf 24 -c:a aac -b:a 128k -movflags +faststart web/public/hero-v7.mp4
ffmpeg -ss 2 -i web/public/hero-v7.mp4 -frames:v 1 -q:v 2 web/public/hero-v7-poster.jpg
```

Keep the v7 edit intact. The paused-video disclosure belongs beside every published copy of this film while shorts remain off. Verify the public image and film URLs after deployment before posting; repository metadata alone does not prove a deployed social preview.
