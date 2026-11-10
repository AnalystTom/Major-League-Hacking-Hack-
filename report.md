# Resurface UI fix evidence

Implemented at `1b8be53f684070bdb2f9aab5443c5e2c6ebaa0d9` on `fm/resurface-ui-fix`; initial committed handoff for Firstmate's no-mistakes pipeline, not a claim of shipped CI or deployment.

## Changes

- Empty, scan and ready cards now sit near the top and use up to 52rem of available width. Removed fixed portrait height, centering spacers and nested panel scrolling; kept the actual video reel dimensions unchanged.
- Settled imports remove only “Processing started. Each link updates as it moves along.” from the existing paste, status and X notes. The X read count and errors remain.


## Verification

Passed: `npm test --prefix web` (86 tests after removal of capability tests), `npm test --prefix deploy/processor` (4 tests), `npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`, and the two isolated Playwright fixture journeys (new-account form reachability at 1280/390, scan dimensions, ready copy, keep persistence, explicit video opt-in).

Tested app URL: http://127.0.0.1:28757/app . That test server has been stopped. Capture host: Big-Machine; isolated headless Chrome/Playwright contexts and synthetic test accounts. Browser operations also used the task-scoped chrome-devtools-axi session; it was stopped. No owner profile or visible window was used.

X provider responses and processing output are the repository's explicit synthetic fixtures, not live private bookmarks or production AI results. No paid X call, production data change, deployment or SHORTS change was made. The server test suite is not separately run because server source did not change; its build/typecheck passed. Full pipeline CI remains the next stage.

## UI quality check

- [x] Empty: compared the supplied live capture with desktop and 390px renders; the paste form and Add links action are visible without the tall blank region.
- [x] Scan: compared the supplied scan capture; wide, top-aligned, content-sized panel, real reported scan stage, no nested scroll region.
- [x] Ready: compared the supplied ready capture; same wide panel, real ready stages, read count retained, stale processing sentence removed.
- [x] Layout and scope: existing palette, Funnel typography, controls and order retained; no clipping, horizontal overflow, extra steps, fabricated product data, new options or unrelated redesign.
- [x] Visual evidence: opened all supplied reference screenshots and every captured screenshot. Desktop is 1280×800; mobile is 390×844. Video records the real fixture walkthrough headlessly on Big-Machine.
- [x] Final evidence is prepared for publication to a durable GitHub evidence branch; the PR will embed before/after images and link the final-head video. Every actual PR evidence URL will be checked before handoff.

Visible differences from references: removed blank portrait space and automatic vertical centering; expanded desktop content width; content flows down the document; mobile card uses inset gutters and existing rounded-card treatment; the settled processing sentence disappears. Viewport differences and explicitly labelled synthetic fixture content are evidence conditions, not extra product changes.

Design skills applied: frontend-design (preserve existing identity and task hierarchy), design-taste-frontend (equal edges, real app content, responsive composition), Impeccable layout/craft floor (Operate mode and content density), and ui-quality-check (rendered comparison). No marketing template, palette deal, animation or new asset was introduced. Impeccable detector findings are all pre-existing: landing bounce easing, live-state pulse dots, and the existing orange button shadow. They were retained to keep this fix scoped.

Ponytail review: finished diff and connected callers reviewed; no findings. Full review saved beside this report in the task proof directory.

## Review handoff

Review URL: https://big-machine-1.tail3c0431.ts.net:24983/

Local review origin: http://127.0.0.1:40283/ . Listener PID: 1153393. Log: `/home/russki/.treehouse/fm-main-7bab20/3/fm-main/data/resurface-ui-fix/review-server.log`. Dedicated HTTPS port 24983 preserves existing Serve routes and does not enable Funnel. Detached project-scoped listener expires after 60 minutes without a GET request (30-second expiry polling).

Local and exact tailnet index returned HTTP 200; exact tailnet review route was verified in isolated headless Chrome immediately before handoff. All six embedded before/after images decoded, video metadata loaded (26.88 seconds), and report returned 200. The verification browser was then stopped. Working tree is clean. The initial optional SHORTS capability feature was removed in pipeline commit 1b8be53 at Firstmate direction. The refreshed screenshots and video were captured from that pushed revision. No capability or SHORTS change remains in the final diff.
