# You page: more ads, incremental reveal, auto-update, and "terrain"

Date: 2026-07-19

## Goal

Four related changes on/around the You page:

1. **More ads** — add discrete, inline native ads in 2–3 more natural spots (never
   interstitial), reusing the existing `SponsoredCard`.
2. **Auto-update audit** — every You-page card must reflect fresh data; fix cards
   holding frozen internal state.
3. **Incremental reveal** — gate the wrapped cards by capture count so the page
   fills in as the user logs (all thresholds ≤ 10), while some cards are always
   present.
4. **"terrain"** — a flagship section (unlocks at ≥ 50 captures) that opens an
   in-depth longitudinal self-portrait of how the user's thinking has moved.

Non-goal: do not touch Atlas/cameras or the Mind detail views (owner working
there). `terrain` must not duplicate Mind (live cognitive forces) or the Atlas
temporal timeline (spatial map over time).

## 1. Ads

Reuse `mobile/components/ui/SponsoredCard.tsx` (native Google ad, FREE-plan only,
"remove ads with Plus" link, renders nothing on no-fill). New inline placements:

- **Archive → diary list** — one card injected after ~6th diary entry.
- **Pulse feed** — one card injected after a few posts.
- **Insight detail end** — one card at the very bottom of a read insight.

All inline, in-stream, gated to FREE. No new ad units required (same env unit id).

## 2. Auto-update

Data already refetches on tab focus (`useFocusEffect` → `refetchWrapped`) and is
recomputed server-side. The concrete bug: `Timeline`'s `range` is chosen once via
`useState(() => defaultRange(daysSinceFirst))` and never re-syncs as history grows,
so an early user who opened on `hours` stays stuck there. Fix: track whether the
user has manually chosen a range; if not, follow `defaultRange(daysSinceFirst)` as
data updates. Audit other cards for the same pattern.

## 3. Incremental reveal (capture-count gates)

Add a count gate on top of the existing data-presence guards in `WrappedSection`:

- Always: hero, social.
- ≥ 3: fields spectrum, topic bubbles.
- ≥ 5: new-topics timeline, rhythm dial, archetype.
- ≥ 7: capture-volume timeline. Streak stays gated on `longestStreak ≥ 2`.

A card shows only when BOTH its data guard and its count gate pass.

## 4. terrain (flagship)

A card in the wrapped stack, shown only at `totalCaptures ≥ 50`, that opens
`mobile/app/terrain.tsx`. A longitudinal self-portrait built by splitting capture
history into an **early era** (first third) and **recent era** (last third);
≥ 100 captures tightens to first/last quarter. Six grounded chapters:

1. **Distance traveled** — centroid of capture `embedding`s early vs recent; cosine
   angle = how far thinking has moved. Drift vector points toward/away from the
   field whose capture-centroid best/worst aligns with the movement direction.
2. **Widening or deepening** — embedding dispersion (mean distance to era centroid)
   per era; rising = widening, falling = deepening. Verdict + both numbers.
3. **Enduring core** — topics present in both eras.
4. **Frontier & faded** — recent-only (emerged) and early-only (faded) topics.
5. **Bridges formed** — cross-domain `MemoryEdge`s created in the recent era.
6. **The arc** — 2–3 sentence cached LLM narrative synthesizing the metrics.

### Cost posture

All quantitative work is deterministic and in-process over data mostly already
loaded. The single LLM call (narrative) plus the whole payload are cached in a new
`TerrainCache` row, versioned by a **capture-count bucket of 25** — regenerates
about once per 25 new captures, not per view, not per capture. The endpoint is only
fetched when the client already knows `totalCaptures ≥ 50`.

### New pieces

- Prisma `TerrainCache` model (`userId @id`, `version Int`, `payload Json`).
- `src/server/services/terrain.ts` — `getTerrain(userId, { tzOffsetMinutes })`.
- `generateTerrainNarrative` in `src/server/cognition/llm.ts` (gpt-4o-mini, JSON,
  null-on-failure — matching existing functions).
- `src/app/api/me/terrain/route.ts`.
- `TerrainResponse` type in `mobile/types/api.ts`; `api.memory.terrain()`.
- Gated `TerrainCard` in `WrappedSection`; `mobile/app/terrain.tsx` detail screen.

### Tests

Unit test for the deterministic era math (distance/dispersion/enduring/emerged/
faded) in `src/server/services/terrain.test.ts`.

## Notes / risks

- `TerrainCache` needs a DB push (`npm run db:push`) locally and on prod, mirroring
  the intelligence cache precedent.
- Embeddings are ~12KB/capture; fetching ~100 on a cached, on-demand endpoint is
  acceptable and only happens past 50 captures.
