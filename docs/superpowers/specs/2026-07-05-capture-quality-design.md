# Capture Quality: Extraction Ladder, Confidence Gate, and User Fail-Safes

**Date:** 2026-07-05
**Problem:** Every downstream feature (map placement, connections, contradictions, insights) is only as good as what capture extracts from the source. Today YouTube transcripts fail in production (Render's datacenter IP gets bot-walled), Reddit/TikTok/Instagram yield nothing, podcasts aren't handled, and when content is thin the insight LLM confabulates an argument from the title alone.

## Goals

1. Maximize the chance that a capture carries substantive content (`bodyText`) for embedding, classification, and insight generation.
2. When extraction fails, never confabulate — detect thinness, tell the user, and ask them for a paragraph (typed or spoken) instead.
3. Let the user correct the AI's understanding after the fact, with full reprocessing so the map, connections, and insights actually change.

## Architecture: three tiers

### Tier 1 — Free extraction improvements (`src/server/metadata.ts`)

Source-specific extractors, tried before the generic scrape:

- **Reddit** (`reddit.com`, `redd.it`): fetch `<permalink>.json` with a browser UA. bodyText = post title + selftext + top comments (top ~5 by score, min length filter). Covers text posts, link posts (title + comment discussion), and video posts.
- **YouTube**: keep the existing watch-page caption scrape (works on residential IPs / dev), but treat it as attempt #1.
- **JSON-LD** (generic + podcast pages): parse `<script type="application/ld+json">` for `articleBody` (news sites often embed the full article) and episode `description` (Apple Podcasts, many podcast hosts). Merged into the generic HTML path.
- **Browser-UA retry**: if the generic fetch fails or yields no body text, retry once with a real Chrome UA + accept-language (many sites serve bots a stripped page).

### Tier 2 — Supadata transcript API (env-gated)

`SUPADATA_API_KEY` optional. When set, and tier 1 produced no transcript/body for a **video/social** URL (YouTube, TikTok, Instagram, X, Facebook), call Supadata's transcript endpoint (`https://api.supadata.ai/v1/transcript?url=…&text=true&mode=auto`). This is the production fix for YouTube (their infra handles the bot wall) and the only realistic route for TikTok/Instagram. Cost: 1 credit per native transcript, free tier 100/month, ~$17/mo beyond. Timeout + graceful failure → tier 3.

Non-goal: Whisper transcription of downloaded audio (podcast episodes without transcripts). It needs a background pipeline (minutes of latency, yt-dlp binary, chunking around Whisper's 25 MB limit) for marginal gain over show notes + the tier-3 fail-safe. Revisit only if tier 1+2 prove insufficient in practice.

### Tier 3 — The user (confidence gate + fail-safe)

**Confidence scoring** (deterministic, computed from what was extracted):
- `rich` — bodyText ≥ 800 chars (transcript or article body)
- `partial` — bodyText/description 150–800 chars
- `thin` — title-only or near-empty description

`ContentItem.bodySource` records where the text came from (`transcript | body | description | jsonld | reddit | user`), so insight prompts know whether they're reading the actual content or a summary.

**Preflight:** `POST /api/captures/preflight { url }` runs ingestion (creates/updates the ContentItem — the later capture dedupes on canonicalUrl) and returns `{ title, confidence, excerpt }`. The mobile capture sheet fires it when the user advances to the reaction step, so by the time they've typed a reaction we know whether we could read the content.

**Fail-safe UI (capture sheet, step 2):** a status line shows what we got ("Read the full transcript" / "Only got the title"). When `thin`, an extra field appears: *"We couldn't read this — what was it about?"* with typing and a mic button (record via expo-av → `POST /api/captures/transcribe` → Whisper → text lands in the field). Skippable, but visually primary when thin.

**`userContext`:** new `CapturedItem.userContext` column. Treated as ground truth in the pipeline: included first in the embedding text, passed to topic classification and insight generation labeled as the user's own account of the content, and counts as content when computing `contentThin`.

## Anti-confabulation

`polishInsights` (and recommendations) receive a content-confidence signal. When thin: the model is told it knows only the title, must not invent claims about the content's argument, and must ground insights in connection/pattern evidence only. This kills the "reads the title, constructs the argument" failure even when the user skips the fail-safe.

## Edit + reprocess

- Insight screen gains an **About** section showing the AI's understanding (userContext if present, else the content excerpt) with an edit affordance (text + voice).
- `PATCH /api/captures/[id] { userContext }` updates the capture then runs `reprocessCapture`:
  1. rebuild combined text (content + userContext + reaction), re-embed
  2. re-classify topics (replace CapturedItemTopic rows, re-apply taste weights delta-neutrally: old weights removed, new applied)
  3. delete all MemoryEdges touching the item, recompute neighbors, recreate edges
  4. delete and regenerate insights
  5. clear `mapX`/`mapY` so the semantic layout re-seeds the node
- Insight text itself is not directly editable — it is derived; correcting the source of truth regenerates it.

## API/type changes

- Prisma: `CapturedItem.userContext String? @db.Text`, `ContentItem.bodySource String?`
- New routes: `POST /api/captures/preflight`, `POST /api/captures/transcribe`, `PATCH /api/captures/[id]`
- `POST /api/captures` accepts `userContext`
- Contracts + mobile types/api client updated in lockstep; mobile adds `expo-av` for recording.

## Testing

- Unit: confidence scoring, Reddit JSON parsing, JSON-LD extraction (fixture HTML), reprocess service (mocked LLM), thin-capture prompt gating.
- Manual: capture a YouTube URL, a Reddit thread, a TikTok, an Apple Podcasts episode, a blocked article; verify status line, fail-safe field, voice note, and post-edit reprocessing.

## Costs

- Supadata: free 100 transcripts/mo, then ~$17/mo. Env-gated; app fully functional without it.
- Whisper voice notes: ~$0.006/min — cents/month.
- No new LLM calls in the happy path (same cleanup/classify/polish calls, better inputs).
