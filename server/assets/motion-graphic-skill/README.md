# motion-graphic-skill, vendored

Shorts are drawn with [motion-graphic-skill](https://github.com/JakeB-5/motion-graphic-skill) (MIT, see LICENSE),
vendored from upstream commit `21e875e` (v0.4.0). `server/src/outputs/render/motion-skill.ts` drives it.

- `SKILL.md`, `references/story.md`, `references/styles.md`, `references/scene-patterns.md`: included verbatim in
  every script-model system prompt, followed by the Resurface portrait/JSON/source-grounding contract.
- `references/critique.md`: included verbatim in each fresh judge request. Resurface's bounded adaptation and
  stored review receipts follow the [processor quality checks](../../../docs/proceed-and-media.md#the-processor).
- `agents/openai.yaml`: upstream agent-host metadata, retained for the complete distribution; it does not
  configure Resurface’s model; see the [provider configuration](../../src/ingest/README.md).
- `assets/engine.html`: the complete upstream source, retained unchanged as the base for the portrait parts.
- `scripts/check.js`, `scripts/record.js`, `scripts/assemble.py`: the skill’s verifier, recorder and part assembler,
  unmodified. Their place in generation and publication is defined by the processor quality checks above.
  `scripts/package.json` only marks them CommonJS inside this ESM package.
- `resurface/_shell.html`: the skill's `assets/engine.html` split with `assemble.py split`, with three changes:
  a portrait 1080x1920 canvas instead of 16:9, the Resurface reel fonts (Funnel Display/Sans, Martian Mono,
  Instrument Serif) in place of the engine's, and `cues(d, scene)` receiving its scene so a cue can follow that
  scene's move.
- `REFERENCE.md`: the reel the shorts follow, the three posts it was made from, and where each rule lives
  (the script prompt, the grounds, the moves).
- `resurface/*.js`, `resurface/head.html`: the Resurface template, written for this repo. Each short's `DATA`
  (source, one entry per narrated scene with its measured length, and the skill if it's ready) fills the
  `/*DATA*/null` placeholder in `config.js`.
- `resurface-short.html`: the assembled template. Rebuild it with `./build-template.sh` after editing a part.
- `chromium-no-sandbox.sh`: the container’s `CHROME` for both verification and recording.

Recording paints every frame (30 fps) in headless Chromium and encodes it; total processing time also includes
narration, verification, revision and review.

All upstream files are from [the entire motion-graphic skill directory at `21e875e`](https://github.com/JakeB-5/motion-graphic-skill/tree/21e875e/skills/motion-graphic),
with the repository’s MIT `LICENSE`. Upstream’s contact sheets use landscape thumbnails even for a portrait
canvas; use its full-size stills and actual portrait-player screenshots to assess readability.

Resurface's caption layout and player separation follow the processor flow above.
