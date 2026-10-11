# Resurface — Unified v0 Spec

This is the single canonical product spec. It supersedes the earlier v0 draft and HTML planning preview.

Status: updated with the agreed YouTube-only v0, import UI, Digestion Prompt, dynamic categories, and voice plus music. The three workflows remain independent. Contracts and provider choices below are proposed; this document does not implement them.

## Goal

**Your saved ideas, applied to your project.**

Combine related saves, match them to what an AI engineer is building, and turn the useful parts into actions. A short explains the recommendation. The useful result is a project-specific task backed by sources.

## Agreed direction

- V0 accepts individual public YouTube links through a simple import UI. No automatic Watch Later import, X ingestion, or other source formats yet.
- Use one real project supplied beforehand. Visitors can supply video links; project onboarding remains outside v0.
- Combine related tutorials when they address the same problem; do not force unrelated videos into one short.
- Match ideas to the project's goal, stack, current work, and available resources.
- Core v0 journey: import links → see processing/results → browse shorts. The separate skills stream supports short → checklist → agent handoff; its delivery integration remains to be chosen.
- The LLM uses a named **Digestion Prompt** to choose useful material, group it, and produce the shared schema. Categories are dynamic and guided by the user's prompt.
- Shorts are roughly 30–45 seconds, with captions, voice, and music. The team reviews and selects real clips for a stable demo order.
- Opus 5.5 writes animation code; a renderer produces the videos.
- Workflow 1 ingests raw artifacts into a shared TigerData schema.
- Workflow 2 turns processed text into Opus scripts/videos and serves a TikTok-style feed with CTAs on the existing Cloudflare page.
- Workflow 3 independently turns ingested material into processed skills and project action items for Codex.

V1 adds Codex-led source acquisition (give Codex a prompt and have it fetch material) and retrieval of additional supporting sources. That acquisition route is distinct from workflow 3's downstream skill export/handoff.

## Proposed user journey

1. Open the import page for the prepared project. Paste individual YouTube links and supply or edit the Digestion Prompt.
2. Import. Each link shows its actual processing state. An unavailable video shows the failure and the known reason; an unknown reason stays unknown.
3. See the resulting categories and ready artifacts. Categories come from the whole successfully retrieved collection and prompt. Empty or failed inputs remain visible in the import results.
4. Browse the TikTok-style feed. Watch a short explaining the useful learning, its project fit when established, and a next action. Scroll, choose a category, pause, enable sound, read captions, or open sources.
5. Where workflow 3 has a ready skill, inspect the supported action list and export/use the selected task in the agreed Codex destination. Skill generation does not wait for video.

Prepare a small collection of actual videos/clips for the demo and label prepared output. Demonstrate a real import if the provider test passes. A curated URL list or fixed demo order is allowed; fabricated transcripts, media, metrics, and delivery receipts are not. For the action demo, show the actual project artifact/diff and check; generation or prompt delivery alone does not establish improvement.

## Categories across the collection

The LLM reads the successfully retrieved units across the whole collection and generates category names according to the Digestion Prompt. One source can support several topics. Display only categories with real, ready recommendations, with counts computed from those records. The six topics below are earlier brainstorming examples, not a fixed taxonomy or claims about the selected YouTube videos.

| Topic | Candidate material | Evidence status |
| --- | --- | --- |
| Agent workflows | Planning, testing, routing, architecture, reusable judgment | Matt Pocock, pstack, and Kun Chen were read. Recommendations are not yet extracted or tested. |
| SEO and distribution | SEO page techniques and related tutorials | User-described topic; X content and link-to-topic mapping remain unverified. |
| Building apps | iOS guides and implementation ideas | User-described topic; specific source and project fit need confirmation. |
| Local AI and infrastructure | Trying tools on an available device | User-described example involving 0xSero; content and requirements unverified. |
| Business growth | Applying learnings from Ernesto's post | User-described example; the meaning of “zero to 150” and its evidence are unverified. |
| Hardware | Pocket Charm and device-specific ideas | User-described example involving witcheer. Exclude from actionable recommendations when the required device is absent. |

Category values are dynamic; schema field names and workflow interfaces remain stable. The demo may use a preset prompt and curated real inputs. Unsupported material gets an exclusion reason rather than an invented project application.

## Visual flow

```mermaid
flowchart TD
  R["Import UI: individual YouTube links"] --> I["Workflow 1: YouTube content extraction; Nimble or tested fallback"]
  I --> U["Ingested units: one source per unit; actual status/error"]
  U -->|Usable content only| D["Digestion Prompt: select, group, categorize, synthesize"]
  P["One real project and a user-supplied prompt"] --> D
  D --> T["TigerData: final artifacts, dynamic categories, source IDs, processed_text"]
  T --> V["Workflow 2: Opus writes video scripts and animation code"]
  V --> M["Render with narration, music, captions; store actual media"]
  M --> F["Cloudflare: TikTok-style feed, sources, CTAs"]
  T --> S["Workflow 3: lessons, processed_skill, project action items"]
  S --> K["TigerData: skill result and readiness"]
  K --> F
  S --> X["Review/export/use in Codex without needing video"]
  F --> C["CTA: inspect skill and select action"]
  C --> X
  X --> Q["Inspect actual agent result and check it"]
  L["V1: Codex fetches inputs and Nimble adds supporting sources"] -.-> I
```

Workflows 2 and 3 consume the same ingestion output independently. Workflow 3 never consumes a video or waits for its render.

## Filtering and Digestion Prompt

Use an explicit project brief plus authorized repository/site material. Record the goal, relevant implementation facts, current blocker, available tools/devices, constraints, and where each fact came from. Unknowns stay unknown.

1. Retrieve actual content or a usable transcript. A URL alone is insufficient.
2. Identify techniques and group sources addressing the same problem; remove duplicates.
3. Compare prerequisites with project facts. Record why the idea fits or exactly what is missing.
4. Preserve disagreements and missing prerequisites. V0 uses only the supplied videos; it does not fetch supporting sources. Specific-gap research belongs to V1.
5. Propose a concrete action and completion check. Prioritize the current goal and satisfied prerequisites.

Do not invent relevance scores, revenue, traffic uplift, effort estimates, repository paths, or implementation results. Expected benefits remain expectations until observed. If nothing fits, show an empty actionable feed and actual exclusion reasons.

**Digestion Prompt input:** successfully extracted units, their source IDs and passages/timestamps, the supplied categorization request, the prepared project context, and reviewed few-shot examples when available. One unit is one source artifact; one final artifact may combine several units.

**Digestion Prompt output:** an `artifacts` list containing schema-valid final artifacts with `name`, contributing `source_ids`/URLs, dynamic `category`, source-grounded `processed_text`, evidence references, and a `selection_reason`; plus an `exclusions` list of usable-but-unselected source IDs and reasons, tied to the same prompt revision. Return no artifact when the evidence is insufficient. Failed retrievals retain their extraction errors outside the LLM. Validate both the shape and referenced source IDs before storing; a user's prompt cannot change the output contract or override grounding rules.

The prompt guides recommendation selection as well as grouping. Workflow 1 produces the synthesis/draft narration; workflow 2 uses the team's Opus generation prompt to write a timed script and animation code. Workflow 3 separately produces a skill and actions.

**Prompt refinement tasks:** build real input → reviewed output few-shot examples from the selected videos; include a useful single source, a justified multi-source combination if the collection supports it, and a rejected source. Check unavailable-source handling separately. Record reviewer approval/rejection and the reason, revise the prompt, and rerun the same collection. Do not combine the two selected videos merely to demonstrate multi-source support.

## Three workflows and ownership

| Workflow | Owns | Input | Output | Independent completion check |
| --- | --- | --- | --- | --- |
| 1. Ingestion | Import UI/API, supplied-YouTube retrieval test with Nimble, extraction, Digestion Prompt, grouping/categories, TigerData schema and contracts | Individual YouTube links, prompt, and authorized project context | Per-source units/errors and reviewed final artifacts | A real video yields usable extracted content and a traceable artifact; unread sources retain actual errors. |
| 2. Video and feed | Opus scripts/style prompts, animation code, narration/music/captions, isolated rendering, publication, Cloudflare feed/player and CTAs | Ready ingestion artifacts | Actual media, video metadata, TikTok-style browsing | A generated clip plays with voice/music/captions on the deployed page using backend data; CTAs reflect actual skill readiness. |
| 3. Skills and actions | Skill generation, project action items, skill review/export, Codex delivery adapter and receipts | Ready ingestion records and project context | Processed skills, action items, actual handoff/result records | A real artifact produces a reviewable skill and executable task that can be used in Codex without any video being generated. |

Workflow 1 owns schema migrations, ingestion writes, and the import screen/module. Workflow 2 owns the feed/player, media pipeline, and deployment wiring; it mounts the import module through an agreed route without rewriting it. Workflow 3 owns skill generation and delivery code and does not edit either screen. Agree exact file ownership before parallel work. Each workflow updates only its own output records, avoiding replacement of another workflow's work.

Freeze the contract, not the category names or prompt wording. Use real retrieved records or explicit empty states, never fabricated product fixtures. Streams 2 and 3 can run independently as soon as workflow 1 publishes a real record.

## Shared TigerData schema

Store **ingested units** separately from **final artifacts**. A unit represents one submitted YouTube video: `id`, original submitted URL, canonical `source_url`, selected start time if supplied, actual retrieved title, `raw_artifact_ref`, extraction method/time, and processing status/error. Keep transcript timestamps when available. Strip Watch Later/list/index parameters from the retrieval URL, while retaining the original submission and selected start time.

The final artifact represents one processed topic, potentially assembled from several units. `processed_text` is the source-grounded content supplied to Opus, which creates the timed video script. `processed_skill` is a separate workflow 3 result; a video script is not a Codex skill.

| Field | Purpose | Writer |
| --- | --- | --- |
| `id` | Stable artifact identity | Workflow 1 |
| `name` | Title of the final processed artifact/topic, grounded in its content | Workflow 1 |
| `source_url` | Original or primary source URL | Workflow 1 |
| `source_ids` | IDs of all contributing ingested units | Workflow 1 |
| `sources` | Every contributing source, with URL, retrieved title, content type, and retrieval time | Workflow 1 |
| `raw_artifact_ref` | Reference to stored raw text/transcript or the original file; preserve evidence | Workflow 1 |
| `processed_text` | Reviewed synthesis/draft narration ready for Opus, with useful lessons and source references | Workflow 1 |
| `category` | Dynamic topic label generated from the collection and user prompt | Workflow 1 |
| `selection_reason` | Source-grounded reason this artifact was selected; keep exclusions separately | Workflow 1 |
| `evidence` | Source passages or video timestamps supporting the synthesis; preserve conflicts | Workflow 1 |
| `project_context_id`, `project_context_version` | Actual project context used for applicability, when the artifact is project-specific | Workflow 1 |
| `version` | Input version tying downstream results to the material they used | Workflow 1 |
| `digestion_prompt_ref` | Stored prompt revision and reviewed few-shot set used to produce this artifact | Workflow 1 |
| `ingestion_status`, `review_status`, `processed_at`, `error` | Actual processing/review state, timestamp, and failure details | Workflow 1 |
| `video` | Nullable joined video result; never imply media exists before rendering succeeds | Workflow 2 |
| `processed_skill` | Nullable joined skill result/status; Markdown is absent until actually generated | Workflow 3 |

These field names are the proposed shared interface, not invented example data. Separate related output records avoid concurrent writers overwriting each other:

Processing states are `pending`, `running`, `ready`, and `failed`; review states are `pending`, `approved`, and `rejected`, with actual reviewer feedback. Status records can exist before output content. Consumption requires a matching input version, `ready` processing, and `approved` review. Do not mark a unit ready merely because its page metadata was retrieved: the pipeline needs usable source content.

- **Video result:** artifact ID/version, project-context version when used, timed script and Opus prompt revision, actual media/caption/narration/music references, music provenance, measured duration, render/review status, actual error.
- **Skill result:** artifact ID/version, project-context version, `skill_markdown`, project `action_items`, supporting references, generation/review status, actual error.
- **Action item:** chosen task, applicability evidence, prerequisites, steps, source references, and a checkable result. Use fewer than three when evidence supports fewer.
- **Handoff:** selected skill/action, exact reviewed payload, destination, delivery status/receipt, result reference, and verification evidence when available.

Large media/files live in storage; TigerData stores their real references and metadata. Video and skill readiness are separate. A video can be ready while its skill is still generating; a skill can be usable while rendering is pending or failed. If inputs or project context change, recheck or regenerate outputs before showing them as current.

### V1 source expansion

Later candidates: X threads, linked pages, GitHub READMEs/docs/skills, newsletters, notes, PDFs, and screenshots. Additional primary-source research can strengthen a recommendation in V1. None is part of v0 input support.

## Workflow 2: feed and CTAs

Serve ready, reviewed 30–45 second vertical videos on the existing Cloudflare page using backend data. Show one active clip at a time. Use muted autoplay for the visible clip, tap to enable sound, scroll/next, pause/play, captions, sources, dynamic category controls, and reduced-motion support. Keep a stable, manually reviewed order for the demo.

While feed metadata loads, show loading. If loading fails, show the actual safe error and retry. If no reviewed clips are ready, show an empty state. Failed playback shows a clip error and allows moving on; the end of the feed shows an explicit end state without fabricated clips or counters.

### Voice, music, and visual references

Both narration and music are required. The simplest proposed setup is [Gemini TTS](https://ai.google.dev/gemini-api/docs/speech-generation) for narration, one team-supplied/licensed instrumental track, and [FFmpeg](https://ffmpeg.org/ffmpeg-filters.html#sidechaincompress) to mix it, lower music under speech, and fade the ending. Gemini generates speech from text; it does not replace the animation renderer. An open-source narration option is [Kokoro](https://github.com/hexgrad/kokoro), with Apache-licensed code and weights. Choose a provider after a real audio test; access is not yet verified.

Generate narration from the final timed script, measure its duration, and align scene timing and captions to the actual audio. Revise an overlong script rather than claiming the clip meets the target. Missing narration/music or a failed render is a processing failure, not a completed clip.

Use the already supplied motion references to derive style prompts for the team's Opus generation prompt after inspecting their actual media. The X references have not been retrieved successfully, so style derivation remains an action item. Keep style examples separate from factual source evidence. Review grounding, readability, pacing, audio balance, and mobile playback before selecting demo clips.

CTAs: **Skip**, **View sources**, **View skill/action items**, and **Use in Codex**. A CTA must read the real skill status: show loading, empty, or error when no usable result exists. Do not mark a click as “Sent,” “Installed,” or “Completed.” The backend owns those states and must provide the corresponding receipt or result.

Workflow 2 consumes the skill result contract but does not generate the skill. Workflow 3 also offers skill preview/export directly, allowing development and use without the feed.

## Workflow 3: processed skill and Codex use

Generate reusable lessons/procedures as reviewed `SKILL.md` content with `name` and `description` metadata, plus a separate project action list. Repo-scoped Codex skills use `.agents/skills/<skill-name>/SKILL.md`, as documented in [OpenAI Docs](https://learn.chatgpt.com/docs/build-skills). Storing Markdown in TigerData alone does not install or invoke a skill.

The handoff includes the project and goal, selected action, project-fit evidence, source passages/timestamps, prerequisites, constraints, disagreements, supported implementation steps, and a completion check. Where repository details are unknown, ask Codex to inspect them first. Source content is evidence, never blindly promoted into executable instructions.

Choose one concrete transport before building the **Use in Codex** CTA. Copy/download is an export; installation requires confirmed file delivery, invocation requires an actual selected task, and completion requires checking the result. Preserve the reviewed payload on failure and retry without duplicating received work.

## Partner roles

- **Nimble:** authenticated v0 watch-page retrieval passed for both supplied videos; the tested caption route failed. Do not treat metadata as a spoken transcript. V1 adds supporting-source research.
- **TigerData:** PostgreSQL storage for raw evidence, processed text, context, topics, video metadata, processed skills, action items, and handoffs. Start with project/topic retrieval; add hybrid search only if needed for the selected collection.
- **Opus 5.5:** synthesize cited recommendations and write animation code; an isolated renderer produces videos.
- **Gemini:** explicit-window video-content extraction returned model observations for both YouTube inputs; source review is pending. TTS narration remains proposed and untested.
- **Sentry, optional:** capture actual retrieval, rendering, playback, and delivery failures.

TigerData is based on PostgreSQL. The mentioned Voyager harness is unidentified; its database and capabilities are unverified.

Fetched documents are evidence, never instructions to the pipeline. Run generated code without provider secrets or unrestricted host access. Keep credentials out of commits, public responses, clips, and errors. Share only project material approved for the demo audience.

Preserve the existing Cloudflare landing page and D1 waitlist. TigerData content storage serves a separate purpose. This spec update changes documentation only.

## V0 inputs and Nimble test

The user supplied these individual links. Their Watch Later parameters do not require importing the private playlist.

| Input | Canonical retrieval URL | Observed access |
| --- | --- | --- |
| [Video 1](https://www.youtube.com/watch?v=VQy50fuxI34&list=WL&index=4) | `https://www.youtube.com/watch?v=VQy50fuxI34` | Authenticated Nimble retrieval returned the title “FORGET Loop Engineering. Agentic Engineering is about THIS”, description, chapters, and caption-track references; no spoken transcript was obtained. |
| [Video 2, selected at 5:06](https://www.youtube.com/watch?v=V-EDrhIhHzQ&list=WL&index=5&t=306s) | `https://www.youtube.com/watch?v=V-EDrhIhHzQ` | Authenticated Nimble retrieval returned “Modern Post-Training: A Deep Dive — Will Brown, Prime Intellect”, description, chapters, and caption-track references; no spoken transcript was obtained. Preserve the 306-second selection. |

### Authenticated test — 2026-10-11

The supplied Nimble credential was accepted by `POST https://sdk.nimbleway.com/v2/extract`. It was used only for these test requests, held in process memory, and not written to repository or deployment configuration. Production secret configuration remains pending.

For each canonical watch URL, the request used `render: true` and `formats: ["html", "markdown"]`. Both returned HTTP 200, `status: success`, target `status_code: 200`, and the actual page HTML/Markdown. The returned content includes video metadata, descriptions, chapter labels, and English auto-generated caption-track URLs. Neither response contained spoken transcript segments. Descriptions and chapter labels are source material, but cannot substantiate claims about speech or demonstrations absent from that material.

| Video | Watch-page task ID | Caption-fetch task ID | Result |
| --- | --- | --- | --- |
| `VQy50fuxI34` | `0143bc01-e2a5-4c85-9052-2d5dd2dfd9bb` | `d85b64c0-c976-43ba-a18c-06bc1e8b0401` | Page retrieved; 5,368 Markdown characters. English caption request through Nimble returned HTTP 500. |
| `V-EDrhIhHzQ` | `33122728-d865-49a6-bb6f-f27780cfec5d` | `4752239a-4c68-47a7-9f4d-3fb8ed526377` | Page retrieved; 2,437 Markdown characters. English caption request through Nimble returned HTTP 500. Preserve the submitted 306-second start. |

The follow-up Nimble requests used the actual English caption-track URLs discovered in those responses, requesting `fmt=json3`, `render: false`, and HTML output. Both returned `success: "false"` and the message `can't download the query response - please try again`. Direct HTTP reads of those same caption URLs returned HTTP 200 with an empty body. The underlying caption failure reason remains unknown. These results establish page retrieval and a failed caption route; they do not establish that every possible Nimble transcript route fails. Browser-action transcript extraction was not tested.

At the end of the Nimble test, neither source was fully ingested for video-grounded synthesis: no spoken transcript or inspected video content was obtained through that route. Do not infer missing dialogue from the descriptions, titles, chapter labels, or the presence of a caption URL.

### Do we need Gemini for ingestion?

**Gemini returned timestamped model extraction for both test segments; source review remains pending.** Google's [video-understanding documentation](https://ai.google.dev/gemini-api/docs/video-understanding#pass-youtube-urls) supports passing public YouTube URLs directly to the API; that feature is in preview. Nimble's [Extract API](https://docs.nimbleway.com/nimble-sdk/web-tools/extract/quickstart) retrieves webpage content. Its [Media API](https://docs.nimbleway.com/nimble-sdk/web-tools/media) downloads media-file URLs and does not itself provide video understanding.

### Gemini test — 2026-10-11

The supplied Gemini key authenticated successfully (`GET /v1beta/models`, HTTP 200). It was held in process memory and not saved in the repository or deployment configuration. Production secret configuration is still pending.

Successful requests used `gemini-3.8-flash:generateContent` with the canonical YouTube URL in `fileData` and explicit `videoMetadata.startOffset`/`endOffset`. JSON output used temperature 0 and a 2,000-token output limit. The prompt requested timestamped speech paraphrases and visual observations, not a verbatim transcript. Source URLs and selected times were compared with the submitted inputs; each timestamp was checked against its requested window.

| Input | Requested segment | HTTP / time | Response ID | Validation |
| --- | --- | --- | --- | --- |
| `VQy50fuxI34` | 0–300 seconds | 200 / 14.2 seconds | `X7_Lav6jLb7W-sAPnfae2AQ` | Correct source URL and start. Two of three observations are within the window; the 338–435 second item is rejected. |
| `V-EDrhIhHzQ` | 306–606 seconds | 200 / 13.0 seconds | `iL_Laq6-CbyI1MkPge_msAs` | Correct source URL and selected start. All three observations are within the window. |

The [returned extraction and validation records](evidence/gemini-ingestion-2026-10-11.json) preserve actual model output, response IDs, token usage, and review states. Five observations passed structural/source-identity/window checks. They remain pending source review: a model's `content_accessed: true` assertion and valid timestamps do not independently prove accuracy. Do not publish them or mark them approved until their speech/visual claims are checked against the video. Some `technique` fields describe presentation or analysis styles rather than actionable engineering lessons; refine that extraction instruction before using it as Digestion Prompt input.

Earlier attempts: the first unbounded `gemini-3.8-flash` request returned HTTP 503 (`UNAVAILABLE`, high demand). The second returned HTTP 200 but claimed a different source URL (`0k1j_1m1i0E`), so that response was rejected. Both `gemini-2.5-flash` fallback requests timed out. An Interactions API request using its documented `processing` object returned HTTP 400 (`Invalid input at 'input[0].processing'`). The successful requests used the [Generate Content video-metadata contract](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding) instead. Full-video content was submitted in the earlier requests; requesting a five-minute focus in prompt text alone did not limit input processing.

**Ingestion direction:** use explicit-window Gemini extraction as the v0 video-content candidate, with validation and source review before Digestion Prompt. Keep Nimble for page metadata and V1 supporting-web research. Preserve request-derived source identity and selected time; never let model-generated metadata replace them. Reject wrong identities and out-of-window evidence, retain actual failure details, and retry without fabricating content. A working transcript provider or supplied transcript remains another route.

This test extracted two five-minute segments only. It did not create a full transcript, run Digestion Prompt, write TigerData records, generate clips/skills, or change the deployed app. Remote SSH to big-machine-1 timed out, so no Playwright or remote video review ran; no test browser/app/server was launched.

## Open questions

These replace the answered 20-question backlog. Recommended answers remain proposals.

1. **Which prepared project and current goal?** Supply its actual brief and authorized repository/site context. Recommend one task with a checkable result.
2. **Where will production Nimble and Gemini credentials be configured?** Both supplied keys authenticated in isolated tests; neither is stored in repository or deployment configuration. Gemini returned model extraction for the selected windows; source review is pending.
3. **Which provider is the motion/video API key for, and where is the existing Opus generation prompt?** Keep that credential separate from extraction and TTS.
4. **Which narration voice/provider and music track?** Recommend Gemini TTS plus one licensed instrumental track; Kokoro is the open-source alternative.
5. **Who reviews Digestion Prompt output and clips?** Recommend one teammate records approval/rejection with reasons and selects the demo set.
6. **Which Codex destination and delivery route?** Recommend a reviewed skill/task export first; direct delivery needs a real acknowledgement. Confirm whether direct delivery must be in the live v0 demo.
7. **Where are rendered media stored?** Use actual storage URLs and metadata in TigerData. Cloudflare is the presentation surface; choose the media storage service before publishing.

## Next actions

- Review the five structurally valid Gemini observations against the actual video moments; exclude the out-of-window item and refine the prompt to extract engineering lessons. Expand beyond the two test windows only after review passes.
- Refine Digestion Prompt with real few-shot examples and approval/rejection feedback; retain prompt revisions and output provenance.
- Inspect the supplied motion examples and derive style instructions for the team's Opus prompt.
- Test one narration/music mix and align captions/scenes to measured audio; select and review the real demo clips.
- Agree the schema and exact file ownership, then build the three independent workflows.

## Acceptance and verification

- Sources, project facts, media, statuses, and result claims come from actual records.
- Import accepts individual YouTube links, removes playlist-only retrieval parameters, and preserves submitted URLs/start times. Metadata-only retrieval does not count as ingestion.
- A failed source shows the actual failure reason and does not enter synthesis as retrieved evidence.
- Categories come from retrieved content and the supplied prompt; category names are not hardcoded into the schema.
- Digestion Prompt output validates against the shared contract and references actual ingested units. Multi-source grouping needs a supported common topic.
- Published clips have actual voice, music, captions, and measured duration; the team records review decisions.
- Each action cites source evidence and project facts establishing its applicability.
- Unmet prerequisites cannot appear as ready work; empty/loading/error states remain explicit.
- A visitor can browse real videos, inspect sources and skills, and complete the agreed action journey on mobile/desktop.
- Workflow 3 can generate and export a real skill/action list without workflow 2 or any rendered video.
- Separate output writes and artifact/context versions prevent stale results or one workflow overwriting another.
- Delivery acknowledgement is distinct from completion and result verification.
- Run Playwright on big-machine-1 in an isolated session; return the tested URL and evidence. If unavailable, report the limit without launching local test windows.
- Clean up only sessions/servers created by the run and verify exit; preserve pre-existing sessions.
- Run ponytail-review before commits/pushes; preserve hooks and unrelated changes.

## Verified Cloudflare deployment

Checked on 2026-10-11 through the authenticated Cloudflare account and public HTTP reads:

- Worker: `resurface`; live page: [resurface.thomasmann2001.workers.dev](https://resurface.thomasmann2001.workers.dev/).
- At inspection, the deployment served 100% version `a8630cd0-183c-45f6-a8d6-64c5cd74fd4c`; its bindings reported the D1 waitlist database and static assets.
- The page and its app/feed scripts respond with HTTP 200 using a browser user agent.
- Served `feed.js` uses the static shorts collection; served `shorts.js` identifies it as sample content. Send changes browser state without a delivery request. `/api/feed` returns 404.
- Therefore the deployed page exists, but a real TigerData-backed video feed and Codex handoff have not been verified or implemented by this spec update. The planned feed must replace sample content with real records or explicit empty states.



## References

- [Nimble](https://docs.nimbleway.com/home)
- [TigerData PostgreSQL platform](https://www.tigerdata.com/docs/get-started)
- [TigerData hybrid search](https://www.tigerdata.com/docs/learn/tutorials/hybrid-search)
- [Manim](https://docs.manim.community/en/stable/)
- [Gemini speech generation](https://ai.google.dev/gemini-api/docs/speech-generation)
- [Gemini YouTube video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Kokoro open-source TTS](https://github.com/hexgrad/kokoro)
- [FFmpeg audio mixing and ducking](https://ffmpeg.org/ffmpeg-filters.html#sidechaincompress)
- [OpenAI Docs: Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [X bookmarks API](https://docs.x.com/x-api/posts/bookmarks/introduction)
- [YouTube playlist restrictions](https://developers.google.com/youtube/v3/docs/playlistItems/list)
- [Hackathon and partner categories](https://www.mlh.com/events/ai-engineer-nyc-2026)
