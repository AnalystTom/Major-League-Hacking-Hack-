# Resurface DESIGN.md (Option A, Tidy Current)

Status: final. Option A "Tidy Current" is the pick for Resurface. Values are read from the shipping code. The spec changes no page except the privacy and terms pages, which now follow the system dark setting. The legacy alternate palettes, the palette picker and the off-scale radii remain as follow-ups.

**Figma kit:** kit = Simple Design System (Figma Community kit); target = page "Resurface" in the "Product design systems" Figma file (https://www.figma.com/design/GJF5f61UdzavA1qZPQWdZM), to be built from this spec. The page does not exist yet. Use its Button, Input, Textarea, Card, Badge, Dialog, Sheet, Select, Progress and List components and its colour, text and radius variables, with these overrides.

| Simple Design System variable | Resurface override (light / dark) |
|---|---|
| Brand / primary fill | `#eb5a00` / `#ff7a1a` |
| Text on brand | `#ffffff` / `#1a1815` |
| Brand text (links, accent text) | `#b84600` / `#ff9447` |
| Background / default | `#f6f6ef` / `#171613` |
| Background / secondary | `#ededE3` / `#1f1d19` |
| Surface / card, input | `#ffffff` / `#25221d` |
| Text / default | `#1f1d1a` / `#f2f0e8` |
| Text / secondary | `#5e5b53` / `#b0ab9f` |
| Border / default | `#d8d6ca` / `#3a362f` |
| Danger | `#b8322b` / `#ff8a75` |
| Night surface (app, sheets, video) | `#221f1b` / `#0e0d0b` |
| Night raised surface | `#312c26` / `#2a2722` |
| Text on night / secondary on night | `#f6f6ef` / `#b7b2a6` (light), `#f2f0e8` / `#a9a498` (dark) |
| Heading, button font | Funnel Display (700 to 800) |
| Body font | Funnel Sans (400 to 700) |
| Mono font | Martian Mono (400, 600) |
| Radius scale | 8 (sm) / 12 (md) / 16 (lg) / 999 (pill) |
| Radius variable overrides | Simple's default 4/8/16 become 8/12/16 |

## Brand intent

Resurface turns the links people saved and forgot into SKILL.md files a coding agent can read. The interface is plain, warm and short on words: warm paper, near-black ink, one orange signal colour, a friendly display face for headings and buttons, monospace only for paths and code the agent will run. It is for developers who already live in Claude Code, Codex, Cursor and Hermes. Calm, not playful; confident, not loud. The signed-in app is always a dark surface; the marketing site follows the system light or dark setting. The launch film and OG image use this orange on dark and must keep matching.

## Colour tokens

Defined once in `web/public/tokens.css`. Light values are the default. Dark values apply under `prefers-color-scheme: dark`. Both sets are scoped to `:root[data-palette="hn"]`, the only palette any visitor gets by default.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f6f6ef` | `#171613` | Page background |
| `--bg-2` | `#ededE3` | `#1f1d19` | Alternate sections, code wells |
| `--paper` | `#ffffff` | `#25221d` | Cards, inputs |
| `--ink` | `#1f1d1a` | `#f2f0e8` | Primary text, strong borders |
| `--ink-soft` | `#5e5b53` | `#b0ab9f` | Secondary text, labels |
| `--rule` | `#d8d6ca` | `#3a362f` | Hairlines, card and input borders |
| `--accent` | `#eb5a00` | `#ff7a1a` | Primary button fill, focus ring, progress, count badges |
| `--on-accent` | `#ffffff` | `#1a1815` | Text on `--accent` |
| `--accent-ink` | `#b84600` | `#ff9447` | Accent-coloured text and links |
| `--late` | `#b8322b` | `#ff8a75` | Errors and failed state |
| `--night` | `#221f1b` | `#0e0d0b` | App, sheets and video surfaces |
| `--night-2` | `#312c26` | `#2a2722` | Raised night surface (dialogs, sheets, bars) |
| `--on-night` | `#f6f6ef` | `#f2f0e8` | Text on night surfaces |
| `--on-night-soft` | `#b7b2a6` | `#a9a498` | Secondary text on night surfaces |
| `--shadow` | `0 1px 0 rgba(31,29,26,.06), 0 18px 40px -24px rgba(31,29,26,.45)` | `0 1px 0 rgba(0,0,0,.3), 0 18px 40px -20px rgba(0,0,0,.8)` | Video frames, onboard card, status panel |
| `--late-on-night` | `#f39a91` | `#f39a91` | Error text on night surfaces |
| `--sh-violet` | `#b9a4f5` | `#b9a4f5` | Hero feed-card illustration only |
| `--sh-signal` | `#4cc38f` | `#4cc38f` | Hero feed-card illustration, ready chip |
| `--sh-amber` | `#f2b84b` | `#f2b84b` | Hero feed-card illustration only |
| `--sh-sky` | `#7fb2ff` | `#7fb2ff` | Hero feed-card illustration only |
| `--sh-coral` | `#f08079` | `#f08079` | Hero feed-card illustration only |

Rules: component CSS uses tokens, not hex. The `--sh-*` pastels are illustration colours, not UI colours. Accent covers one primary action per view. Known gap (not changed): white on `#eb5a00` is 3.5:1, which passes only as large text; `.btn-small` at 15px is below AA. The fix to pick later is `#16150f` on orange (5.2:1).

Unused palettes: `highlighter`, `cobalt` and `violet` are still reachable (`?palette=` and the `?pick` picker), so they stay in `tokens.css` unchanged. They are not part of the brand and get no Figma variables.

## Typography

Families: `--display` Funnel Display (fallback Funnel Sans), `--sans` Funnel Sans, `--mono` Martian Mono. All load from Google Fonts: Funnel Display 400..800, Funnel Sans 400..700, Martian Mono 400 and 600.

| Role | Family | Weight | Size / line height |
|---|---|---|---|
| Hero H1 | Display | 800, tracking -.045em | `clamp(3rem, 8.6vw, 8rem)` / 1 |
| Section H2 | Display | 800 | `clamp(2.25rem, 5.2vw, 4.25rem)` / 1 |
| Page H1 (legal) | Display | 800, tracking -.03em | `clamp(2rem, 5vw, 3rem)` / 1.05 |
| Sheet and dialog H2 | Display | 800, tracking -.02em | 1.5rem (24px) / 1 |
| Card title | Display | 700 | 1.25rem (20px) / 1 |
| Body | Sans | 400 | 1.0625rem (17px) / 1.55 |
| Body small | Sans | 400 | .9375rem (15px) / 1.55 |
| Label, hint | Sans | 600 to 700 | .875rem (14px) / 1.45 |
| Caption, chip | Sans | 700 | .75rem (12px) / 1.3 |
| Button large | Display | 700 | 1.1875rem (19px) / 1 |
| Button small | Display or Sans | 600 to 700 | .875rem to .9375rem / 1 |
| Code, path | Mono | 400 | .8125em / 1.55 |

Target scale (applies only when a rule is next edited, never as a sweep): 12, 14, 15, 17, 19, 20, 24, then the three fluid display sizes. Sizes between steps (`.8125rem`, `.9rem`, `1.125rem`, `1.3125rem`, `1.375rem`) are legacy.

## Spacing, radius, shadows

- Gutter: `--gutter: clamp(16px, 4vw, 48px)`. Max content width `--max: 1200px`. `--inline` centres content to that width.
- Spacing steps (target): 4, 8, 12, 16, 24, 32, 48, 64, 96. Legacy gaps (6, 10, 14, 18, 20, 22, 28) stay until their rule is touched.
- Radius scale: `--r-sm` 8px (code wells, chips), `--r-md` 12px (buttons, inputs, list rows), `--r-lg` 16px (cards, results), `--r-pill` 999px (counts, journey pills). Legacy radii 10, 14, 18, 20, 22, 24, 26 stay in the shipping CSS until a page is redesigned; new work uses only the four tokens.
- Shadow: `--shadow` for video, onboard card, reel, status panel. Primary button: inset `0 -3px 0 rgba(0,0,0,.16)` press edge plus a coloured lift on hover.

## Layout and breakpoints

- Breakpoints in use: 960px, 640px, 600px. Target is two: 960 and 640.
- Marketing: content centred to 1200px; sections padded `clamp(72px, 10vw, 128px)`.
- App: sticky top bar 61px (57px at 640px and under). Skills sheet fixed to the right, full width on phones.
- Legal pages: 46rem column, 20px side padding.
- Tap targets 44px minimum on phones.

## Components

**Buttons.** One family, today implemented as separate classes. Anatomy: label, optional leading icon, 8px gap.
- Primary (`.btn`): `--accent` fill, `--on-accent` text, 12px radius, 18px by 26px padding, Display 700 19px, press edge. Hover: lift 2px and glow. Active: lift 0. Disabled: 55% opacity. Focus: 3px `--accent` outline, 3px offset.
- Small (`.btn-small`): 15px text, 11px by 16px padding, 10px radius (legacy, target 12).
- Outline (`.btn-copy`): transparent, 2px `--ink` border, 12px radius.
- Top-bar quiet (`.btn-quiet-top`), pills (`.topbar-pill`, `.journey a`, `.status > summary`), and `.reel-btn` are the same role at different sizes; unify the base when next touched.
- Delete account is still styled like Sign out (known gap, not changed). Target: danger variant, `--late` border and text.

**Inputs.** 2px `--rule` border, 12px radius, 12px by 14px padding, `--paper` fill, body font. Link textareas use Mono. Focus replaces the outline with an `--accent` border (known gap: the ring is removed).

**Cards.** `--paper` fill, 1px `--rule` border, 12 to 16px radius, 12 to 18px padding. Skill card: status chip, source line, title, description, path well, actions. `:target` adds an accent outline.

**Nav.** Sticky, `--bg` at 86% with blur. Wordmark left, links, one primary small button. App bar uses night colours.

**Modals and sheets.** `<dialog>`, `--night-2` fill, 20px radius (target 16), `::backdrop` black at 55 to 60%. Title H2, body, one primary action, one quiet dismiss.

**Lists.** Unit rows: 12px radius, 1px `--rule` border, source link, stage label right. Journey pills: 999px radius. Three-step scan bar with current step in `--accent`.

States for every control: default, hover, active, focus-visible, disabled, and error where it takes input.

## Imagery and illustration

- Launch film and reel video stay as is, in a 24px frame with `--shadow`.
- Agent logos are one-colour masks (`currentColor`).
- Hero feed cards use the `--sh-*` pastels; they are illustration, not UI.
- No stock illustration; show the real artefact (a SKILL.md, a path, a terminal).
- Empty states: dashed 2px `--rule` box, one sentence, one action.

## Motion

- Colour and border transitions 150ms. Button lift 120ms ease.
- Easing tokens: `--ease-out: cubic-bezier(.2, .8, .2, 1)` for enters, `--ease-slide: cubic-bezier(.7, 0, .2, 1)` for the reel slide (700ms).
- Hero word reveal 850ms. Feed-card illustration animations 350ms to 6.5s, scoped to `.short.play`.
- `prefers-reduced-motion: reduce` removes all of it (end of `styles.css`).

## Voice and copy rules

- Second person, present tense, sentence case, no exclamation marks.
- Say what the thing is: "Copy SKILL.md", "Add links".
- One name per thing: skill, link, source.
- Errors say what happened and what to do next in one sentence.
- Buttons: verb first, at most four words. Known drift to fix later: "Add links" / "+ Add links"; "Get started" / "Get started, it's free".
- State limits plainly ("up to 20 videos and 100 X posts").

## Do and don't

- Do use tokens. Don't add hex or a fallback like `var(--paper, #faf7f2)`.
- Do use the four radius tokens in new work. Don't add 10, 14, 18, 20 or 24.
- Do keep one primary action per view. Don't place two orange buttons side by side.
- Do keep the 3px accent focus ring. Don't remove an outline without a replacement of equal contrast.
- Do show real data and explicit loading, empty and error states. Don't fabricate values.
- Don't ship new palettes or a picker to users.

## Where tokens live in code and how to use them

- `web/public/tokens.css` is the single token file: fonts, easing, gutter, radius scale, the `hn` palette (light and dark), and the legacy alternate palettes. Every page loads it before `styles.css` (`index.html`, `app.html`, `start.html`, `available.html`, `404.html`, `launch-v7-transcript.html`) and `legal.css` imports it.
- In CSS write `var(--token)`. New colours, sizes and radii go into `tokens.css` first.
- The skills sheet and app page remap `--bg`, `--ink` and friends to the night tokens locally to stay dark; new tokens must be remapped there too.
- Figma variable names map 1:1: `--accent` is "Brand / primary fill", and so on per the table at the top.
