# motion-graphic-skill, vendored

Shorts are drawn with [motion-graphic-skill](https://github.com/JakeB-5/motion-graphic-skill) (MIT, see LICENSE),
vendored from upstream commit `21e875e` (v0.4.0). `server/src/outputs/render/motion-skill.ts` drives it.

- `scripts/record.js`, `scripts/assemble.py`: the skill's recorder and part assembler, unmodified.
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
- `chromium-no-sandbox.sh`: the container's `CHROME` for record.js.

Rendering paints every frame (30 fps) in headless Chromium and encodes it, so a 35-45 s short takes about two
minutes on the processor's half a CPU. `RENDER_STYLE=basic` switches back to the plain ffmpeg text cards.
