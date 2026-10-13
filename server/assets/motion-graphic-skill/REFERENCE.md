# The reel every short is drawn after

Every short follows the Resurface demo reel, the hero video on the landing page (`web/public/resurface-reel.mp4`).
The reel was made from three reference posts, each a short motion-graphics piece made by a model:

| Post | What it gave the reel |
| --- | --- |
| [stephanlivera/2103315922098470926](https://x.com/stephanlivera/status/2103315922098470926) | Hard cuts between flat colour fields (black, signal orange, cream, blue). Mono HUD in the corners with a running timecode. A wordmark that lands letter by letter. |
| [blueemi99/2106031355922387163](https://x.com/blueemi99/status/2106031355922387163) | Heavy display type set against an italic serif. One idea per cut, fast. Sound effects tied to each move, with no stock music. |
| [minchoi/2104227722377757031](https://x.com/minchoi/status/2104227722377757031) | Kinetic type that lands on the voice: struck and swapped words, counters, stamps, a prompt typing with its cursor. |

## The rules, and where they live

**Script.** `server/src/outputs/render/script.ts` sets the rules in `SCRIPT_SYSTEM_PROMPT` (`script-v2`).
- One idea per scene.
- The headline is at most 5 words, and the aside is at most 8 words in a second voice.
- Each scene gets one move and one ground.
- Length follows the source, with no padding.
- Nothing stronger than the source says.

`validateScript` falls back to `slam` for any move the template can't draw honestly. That covers a strike or roll with nothing to swap to, and a count of a number the source never states.

**Grounds.** `resurface/style.js` defines four grounds:
- `night`: black.
- `signal`: orange.
- `paper`: cream.
- `cobalt`: blue.

Scene 1 is always night and the end card is always paper. `groundsFor` in `motion-skill.ts` makes sure consecutive scenes never share a ground. A cut is a band wipe, except into cobalt, which irises open from the centre as the reel cuts into its blue chapter.

**Moves.** `resurface/scenes.js` draws each move. Their sound cues use the engine's synthesised effects.

| Move | On screen | In the reel |
| --- | --- | --- |
| `slam` | The words hit from the right with a skew and motion blur. | "SAVED FOR", "YOUR AGENT." |
| `strike` | The last word is struck through, and the swap rises under it in the italic serif. | "SAVED FOR ~~LATER~~ *never.*" |
| `roll` | The headline rolls letter by letter into the swap. | "KEEPS" → "SKILLS" |
| `stamp` | The swap is stamped under the copy at an angle, with a short camera shake. | "AT LAUNCH" |
| `count` | The source's number counts up huge, and the rest of the headline slams in under it. | "0:00" → "0:30" |

**Frame.** The HUD has corner marks, `RESURFACE`, the scene code, the timecode and the source tag. The italic serif aside carries the second voice.

**Honesty.** The copy comes only from the artifact. The end card names a skill only when that skill is ready; otherwise it shows the next step.
