# motion-graphic-skill, vendored

Shorts are drawn with [motion-graphic-skill](https://github.com/JakeB-5/motion-graphic-skill) (MIT, see LICENSE),
vendored from upstream commit `21e875e` (v0.4.0). `server/src/outputs/render/motion-skill.ts` drives it.

- `SKILL.md`, `references/story.md`, `references/styles.md`, `references/scene-patterns.md`: included verbatim in
  every script-model system prompt, followed by the Resurface portrait/JSON/source-grounding contract.
- `references/critique.md`: included verbatim in each fresh judge request. Two reviewed rounds surround one bounded storyboard revision and rebuild, with all eleven defect rows, seven 1–10 axes (all ≥8), evidence, caps and no unearned score increases. The six source/caption criteria additionally require ≥4/5. Each round has a builder cue check; both reviews, fixes, `review_log` and `cue_checks` persist in the publication receipt. Round 2 must pass; there is no third round.
- `agents/openai.yaml`: upstream agent-host metadata, retained for the complete distribution; it does not
  configure Resurface’s model. Deployment uses `OPENAI_MODEL`, script medium and judge high reasoning.
- `assets/engine.html`: the complete upstream source, retained unchanged as the base for the portrait parts.
- `scripts/check.js`, `scripts/record.js`, `scripts/assemble.py`: the skill’s verifier, recorder and part assembler,
  unmodified. Every motion render runs the full verifier before recording; any failure prevents publication.
  Its audio/layout/determinism report accompanies the actual subtitled frames to the independent model judge.
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

Rendering paints every frame (30 fps) in headless Chromium and encodes it, so a 35-45 s short takes about two
minutes on the processor's half a CPU. `RENDER_STYLE=basic` switches back to the plain ffmpeg text cards.

All upstream files are from [the entire motion-graphic skill directory at `21e875e`](https://github.com/JakeB-5/motion-graphic-skill/tree/21e875e/skills/motion-graphic),
with the repository’s MIT `LICENSE`. Upstream’s contact sheets use landscape thumbnails even for a portrait
canvas; use its full-size stills and actual portrait-player screenshots to assess readability.

Resurface’s composition keeps key content above y=1340. Timed captions occupy only x=108..972,
y=1420..1720 over a solid dark panel. Both script and judge receive these bounds; the judge explicitly rejects
caption overlap. Player metadata, controls and source details occupy a separate row outside the complete video frame. The opening’s lesson starts at 0.12 seconds, with compact source context above it.
