# Pipeline reference

Paths are relative to the Resurface repository root. Read the current code before relying on these mappings.

| Concern | File |
| --- | --- |
| Input contract and evidence validation | `packages/motion-shorts/src/contracts.ts` |
| Artifact-to-input adaptation | `packages/motion-shorts/src/ingestion.ts` |
| Script prompt and request deadlines | `packages/motion-shorts/src/provider.ts` |
| Fast script schema, composition, TTS, FFmpeg and upload | `packages/motion-shorts/src/fast-video.ts` |
| Diagram geometry, routes and captions | `packages/motion-shorts/src/visual-language.ts` |
| Queue, advisory locking and database readiness | `packages/motion-shorts/src/worker.ts` |
| Probe, decode checks and frame extraction | `packages/motion-shorts/src/media.ts` |
| Frontend caption metadata | `web/src/feed.js` |
| Website playback and layout | `web/public/reel.js`, `web/public/styles.css` |

## Current editorial contract

`editorial-props.ts` adds original animated chamber, observer, packet and network illustrations. Use these only when their meaning matches the source. They represent roles, not product screenshots, measured traces, successful detection or physical deployment locations. Review animation over time, not just a contact sheet.

Recurring non-text object IDs with unchanged kind, text and colors carry their terminal position into the next shot over 0.6 seconds. At least two adjacent boundaries must preserve an object, and two shots must demonstrate object travel. Movement is a minimum structural check, not proof of editorial quality.

The default is `resurface-editorial-v10`: `editorial-plan.ts` validates four to six shots and content coverage, `editorial-stage.ts` captures deterministic compositions, and `editorial-video.ts` audits claims/visuals, synthesizes speech, encodes and verifies delivery. A failed content audit gets one corrective attempt, then fails without replacing ready media. Dense narration over 200 words fails explicitly; automatic splitting is not implemented.

`MOTION_GENERATION_MODE=fast` retains `resurface-connected-v7` and its legacy three-beat format. `creative` retains the original pipeline. Update the feed's burned-in-caption recognition with new revisions. Keep older ready media available until replacements pass decode and upload readback.

## Local commands

Use `npm.cmd` on Windows. These commands run from the repository root:

```powershell
npm.cmd run motion --prefix packages/motion-shorts -- doctor
npm.cmd run motion --prefix packages/motion-shorts -- editorial <sourced-input.json>
npm.cmd run motion --prefix packages/motion-shorts -- inspect <short.mp4>
npm.cmd run motion --prefix packages/motion-shorts -- frames <short.mp4> <review-directory>
npm.cmd test --prefix packages/motion-shorts
npm.cmd run typecheck --prefix packages/motion-shorts
npm.cmd run lint --prefix packages/motion-shorts
```

`editorial` spends configured provider credits but does not upload by default. Its `--upload` flag delivers media without updating the database. The worker performs the database transition. Use it only for requested queue processing; `--once` still processes a batch, not a single chosen artifact. Do not use `--refresh-ready` to test one design unless refreshing the queue is requested.

The Node server also contains a built-in video producer. `VIDEO_PROVIDER=motion` disables that producer while keeping skills enabled. If unset, a configured `MOTION_MEDIA_STORAGE` currently selects motion implicitly. Other deployments default to the built-in producer. Avoid running competing video producers against the same queue; starting the Node server alone does not start the motion worker.

Credentials belong in ignored environment files. Read only required values internally; do not print them. Preserve existing storage mode and database configuration during visual work.

## Design provenance

This is an original Resurface-specific skill, informed by the public [JakeB-5 motion-graphic workflow](https://github.com/JakeB-5/motion-graphic-skill). That workflow targets a standalone HTML film; this adaptation targets the existing narrated MP4 pipeline. No upstream engine or scripts are bundled. The referenced X post could not be verified as pointing to that repository.
