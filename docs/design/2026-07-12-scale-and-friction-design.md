# Scale & Friction Pass — Design

Date: 2026-07-12

## Problem

Two fundamental gaps stand between the current build and a Letterboxd-grade
logging product:

1. **Capture is slower than it needs to be.** The share-sheet path is already
   one-tap, but the in-app flow forces every capture through two steps
   (payload → reaction → commit) even though the reaction is optional. Logging
   apps win on speed; every extra tap is churn.
2. **The map degrades silently and unusably at scale.** The Atlas fetches the
   80 most recent captures (`limit: 80`, server clamp 200). Past 80 captures,
   older nodes silently vanish — the "map of your mind" quietly becomes "map
   of your last few weeks", and nothing tells the user. And if the limit were
   simply raised, the single map would become the feared amalgamation.

## Design

### A. Topic sub-maps (scale handling)

The Atlas becomes **layered instead of infinite**:

- **Overview** stays bounded at the 80 most recent captures — framed honestly
  as the recent surface of the mind, not the whole archive.
- **Focusing a field/topic opens that topic's own complete map.** The existing
  focus flow (tap cluster label → drawer → "focus") today only dims non-member
  nodes among the recent 80. Now it fetches `GET /api/memory/graph?topicId=X`
  — *every* capture in that topic (up to 200), rendered as a dedicated sub-map
  using the same persisted semantic coordinates, with the camera animating to
  fit the subset. Clearing focus returns to the overview.
- **Honest counts everywhere.** The graph response gains `totalCount` (matching
  rows before the limit). The info panel shows "80 of 214 points" when
  truncated; the focus badge shows the topic's real capture count.

Server: `getMemoryGraph` gains optional `topicId` (filters
`topics: { some: { topicId } }`) and returns `totalCount`. Persisted
`mapX`/`mapY` layout logic is untouched — a topic subset re-uses the same
coordinates, so the sub-map is spatially consistent with the overview.

Mobile: a small hand-rolled focused-graph fetch keyed on `focusedTopicId`
(with a sequence guard; `useApiQuery`'s fixed-cache-key semantics don't fit a
changing key). Until the focused data lands, the existing dim-the-overview
behavior remains as the interim state. When it lands, the node/edge/cluster
set swaps to the focused graph and the camera flies to fit it.

### B. One-step capture (friction)

- **Quick save.** Step one's primary action becomes `save →`: it commits
  immediately (same commit path; reaction/userContext empty). A secondary
  `+ reaction` action leads to the old step two for people who want it.
  Commit was already never gated on the preflight — an unreadable source is
  handled after the fact by the insight screen — so nothing is lost by
  skipping step two.
- **Quick save stays on the map.** Instead of pushing the insight screen, it
  shows the landing ring plus a transient "saved · see insight →" pill, making
  in-app capture feel like the share-sheet path. The full (reaction) flow
  keeps its current behavior of opening the insight.
- **Copied-link fast path.** When the capture sheet opens and the clipboard
  holds a URL (`Clipboard.hasUrlAsync()` — checked without reading, so no iOS
  paste banner), step one shows a one-tap `use copied link` chip that fills
  the field. Capture becomes: copy anywhere → open Mneme → two taps.
- **The guided walkthrough is untouched:** while the tutorial spotlight is on
  step one, the original `next →` flow is presented, so the tutorial's
  step-two targets stay valid.

## Out of scope

- Raising the overview limit past 80 (perf is fine; the layered model makes it
  unnecessary).
- pgvector / server-side clustering — not needed at the 200-per-topic scale.
- Multiple user-created maps; topics *are* the map partition.

## Verification

- Unit tests for `getMemoryGraph` topic filtering + `totalCount` (fake-db
  pattern from `archive.test.ts`).
- `npm run test:unit`, backend `tsc --noEmit`, mobile `tsc --noEmit` all clean.
