---
name: motion-graphic
description: Design, improve, and verify source-backed Resurface motion shorts using the existing motion-shorts renderer. Use for visual storytelling, animation, caption readability, and rendering-speed work in this project.
---

# Resurface motion graphic

Turn a backend artifact into a clear visual explanation in the website's vertical video format. Apply improvements to the shared generator unless the user explicitly requests a single clip. This skill guides the coding agent; installing it does not change the running generation service.

## Start with the actual pipeline

Locate the repository containing `packages/motion-shorts/package.json`; do not assume the current directory is the repository. Read its `AGENTS.md` and inspect the current renderer before editing. Read [references/pipeline.md](references/pipeline.md) for entry points, commands, and delivery constraints. Keep generated media in the ignored artifacts directory.

Use the artifact's processed text and evidence as the content authority. Distinguish a short about one extracted topic from a summary of the complete source video. Associate every narrated claim with existing evidence IDs. Missing evidence is a content blocker, not permission to invent a statistic, quote, result, or relationship.

For an authorized implementation, write a compact storyboard and proceed with reasonable design choices. Ask only for information that materially changes the story or scope. Do not introduce a storyboard approval gate when the user already authorized the work.

## Make the explanation visual

Start with a concrete subject and what it does. Choose a diagram that expresses the actual relationship: movement through a workflow, repeated feedback, alternatives, or an isolation boundary. Keep the visual understandable with narration muted.

Use this planning format for each beat:

`claim + evidence IDs | visible actors | relationship | what changes over time | spoken explanation`

Keep narration responsible for nuance, and labels responsible for identifying objects. Avoid rendering the spoken paragraph as the central visual. Replace generic promises such as "unlock the future" with a specific action supported by the artifact.

Motion should explain a change of state or direct attention. Reveal relevant actors, trace a valid connection, and settle on the result. Prefer coherent object movement over repeatedly replacing text cards. Avoid ornamental pulses, spinning icons, and generic transition effects that compete with the mechanism.

Preserve direction and meaning: an observer watching an agent is not a gateway through which requests flow. A containment boundary is not proof of complete security. A comparison diagram is not quantitative evidence. Never add a causal arrow merely to fill the composition.

## Work within the renderer

The default editorial renderer uses four to six independently composed shots, source-linked content points, and an independent content/visual audit. Choose a visual world specific to the topic; vary scale and composition for a reason. The three-node fast renderer is legacy opt-in. Never force every subject into the same diagram or silently shorten away caveats.

Preserve the website player while giving each film its own coherent palette and typography. At 1080x1920, keep shot elements within validated safe bounds and captions in their separate lower band. Test at approximately 390 CSS pixels wide; shortening labels is preferable to shrinking important text until it is unreadable. Inspect long titles, edge labels, and the last caption at the smallest supported size.

Use a deterministic timeline for new animation: the same timestamp must produce the same frame. Keep scene duration tied to measured narration audio. Validate route geometry, including repeated points, before building interpolation expressions. Do not animate division by zero or an unsupported connection.

## Keep the performance target honest

Target less than 60 seconds from ready artifact text to a validated, delivered short. Measure generation, voice, render, and upload separately. Report queue and ingestion time separately. Cached rerenders do not establish cold-generation performance.

Reuse stage caches, parallel independent speech work, and FFmpeg. Editorial scenes currently use deterministic browser capture at 24 fps and a separate source-coverage review. Measure both costs; this path does not yet reliably meet the sub-minute cold-generation target. Preserve user-selected providers and credentials. Bound retries; report the failing stage instead of silently repeating paid requests.

## Verify and hand back

Inspect rendered frames from each beat and around transitions, then check playback with sound. Review source fidelity, diagram meaning, readable labels, caption separation, and pacing. A successful encode does not prove visual quality. Phrase-level estimated captions must not be described as word-aligned.

For shared code changes, run relevant motion tests, typecheck, and lint. Follow repository-required web/server checks when those files change. For frontend changes, use an isolated headless test account and preserve existing user sessions. Verify actual media delivery before marking a database result ready.

Return the output location or tested URL, measured timing and its scope, completed checks, and any unresolved defect. Do not promise "10/10" or claim a source video was watched when only its extracted evidence was used. Creating this skill alone does not rerender existing clips, start workers, upload media, or push code.
