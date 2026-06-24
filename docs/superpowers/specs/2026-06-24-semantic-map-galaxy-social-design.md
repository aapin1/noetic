# Design: Semantic Map Fix · Topic Galaxy · Social Pulse · Socratic FAB

**Date:** 2026-06-24  
**Status:** Approved  
**Scope:** Mobile-only changes except one new backend API route (`/api/social/feed`)

---

## Problem Summary

Three compounding UX failures identified with ~5 captures in a fresh account:

1. **Semantic map** places similar articles far apart — the layout algorithm has no repulsion force, so attraction-only physics collapse into cluster centers rather than revealing semantic proximity.
2. **Drift tab** shows useless flat/empty graphs with few captures — momentum bars require prior-period data that doesn't exist yet; sparkline is nearly all zeros.
3. **Social layer and Socratic companion are inaccessible** — social backend exists but has no mobile UI; Socratic is buried behind 2 contextual taps.

---

## Fix 1: Force-Directed Semantic Map Layout

**File:** `mobile/app/(tabs)/index.tsx` — `layoutGraph()` function only. No backend changes.

### Current behaviour
- Nodes placed near their primary topic cluster centre with 18–52px random jitter.
- 3-pass midpoint-averaging loop with edge-type pull factors (RECURS: 0.42, REINFORCES: 0.30, etc.).
- **No repulsion** — unrelated nodes pile up at cluster centres; attraction has nothing to work against.

### New behaviour

Replace the 3-pass loop with a 20-iteration force-directed settle:

**Repulsion (all pairs):**
```
force = k_repel / distance²
```
Applied symmetrically to push every node pair apart. `k_repel` chosen so two nodes at the minimum comfortable separation (~60px) experience a repulsion equal to a medium edge attraction. Capped at a max displacement per iteration to prevent explosions.

**Edge attraction (explicit MemoryEdges):**
Same `EDGE_PULL` constants as before, applied each iteration. Force scales with `edge.weight` (already 0–1 from cosine similarity). CONTRADICTS remains slightly repulsive (`-0.12`).

**Topic bonding (implicit attraction):**
For every pair of nodes sharing ≥1 topic (no explicit edge required), apply a mild attraction force of `0.06 × shared_topic_count`. This handles the "similar articles not yet connected by an edge" case.

**Damping:**
`displacement = force × (1 - iter/iterations)` — force magnitude decays to zero by the final iteration so nodes settle rather than oscillate.

**Boundary clamping:** unchanged — nodes cannot leave `[pad, w-pad] × [pad, h-pad]`.

### Why this is the correct fix
Without repulsion, even with more iterations, nodes converge toward cluster centres regardless of semantic distance. Repulsion creates the force field that attraction can work against, allowing genuine proximity to emerge from similarity rather than random jitter.

---

## Fix 2: Topic Galaxy (Drift Tab Redesign)

**Tab:** `drift` (third tab) — same name and slot.  
**File:** `mobile/app/(tabs)/trends.tsx` — full replacement of body content. `ActivityStrip` in `memory.tsx` is unchanged.

### Layout

**Galaxy canvas (top ~55% of screen):**
- Pure SVG via `react-native-svg` (already installed — no new dependencies)
- Each topic rendered as a circle:
  - **Radius** = `clamp(16, captureCount / maxCount × 48, 48)` px
  - **Radial position** = inverse recency score: topics with captures in the last 7 days orbit near centre; older topics orbit further out
  - **Color** = `CLUSTER_PALETTE[topicIndex % palette.length]` — same palette as atlas, keeping visual identity consistent across tabs
  - **Label** = topic name in `FontFamily.mono`, `FontSize.xs`, rendered below each bubble; fades/hides when bubble radius < 20px
- Soft radial gradient ambient glow behind the cluster (matches atlas aesthetic)
- Static layout — no physics, no animation. Position computed once from data.

**Below the galaxy (bottom ~45%):**
- Single prose pulse line: `"N topics active · M rising · K quiet"` — computed from existing `shifts` and `recurring` arrays, no LLM call
- Tensions/events list unchanged (already well-designed)
- 7d/30d toggle unchanged

**Empty / sparse state:**
- `< 2 topics`: single centred ghost bubble + copy: `"your galaxy grows as you capture more"`
- `1 topic`: single bubble centred, no radial positioning needed

### Data source
Existing `GET /api/memory/trends` endpoint — no backend changes. The galaxy reads `data.themes` (all topics with counts) and `data.shifts` (delta) from the same response already consumed by the drift tab.

---

## Fix 3a: Pulse Tab (Social Feed)

**Replaces:** drift tab slot.  
**New tab order:** `atlas · archive · pulse · mind · you`

### New backend route
`GET /api/social/feed`
- Auth-required, returns paginated public captures from users the caller follows
- Query params: `cursor?: string`, `limit?: number` (default 20, max 40)
- Response shape:
```ts
{
  items: FeedItem[];
  nextCursor: string | null;
}

type FeedItem = {
  id: string;
  capturedAt: string;
  title: string;
  rawText: string | null;
  keyIdea: string | null;
  kind: string;
  topics: { topicId: string; name: string }[];
  author: { id: string; handle: string; displayName: string; avatarUrl: string | null };
  likeCount: number;
  isLiked: boolean;
  isSaved: boolean;
};
```
- Implementation: `db.capturedItem.findMany` where `userId IN (SELECT followingId FROM Follow WHERE followerId = $me)` and `visibility = PUBLIC`, ordered by `capturedAt DESC`, cursor-paginated on `capturedAt + id`.

### Mobile screen (`mobile/app/(tabs)/pulse.tsx`)
- Feed list of `FeedCard` components (avatar, handle, capture title/text, topics chips, date, like + save buttons)
- Pull-to-refresh
- Cursor-based infinite scroll (load more on scroll-near-bottom)
- **Empty state (no follows):** centred prompt + search input to find users by handle/display name. Tapping a result shows a minimal profile card with follow button. No separate screen needed.
- Like/save actions call existing `POST /api/social/like` and `POST /api/social/save` routes
- Comments deferred to next sprint

### Tab icon
`UsersIcon` from `lucide-react-native` (already installed)

---

## Fix 3b: Persistent Socratic FAB

**New component:** `SocraticFab` — rendered once in `mobile/app/(tabs)/_layout.tsx` as an overlay above the tab bar, so it persists across all 5 tabs without re-mounting.

### Visual spec
- 40px circle, `position: absolute`, `bottom: TAB_H + 12`, `right: Spacing[5]`
- No fill (`backgroundColor: transparent`)
- Hairline border (`borderColor: c.border`, `borderWidth: 1`)
- `MessageCircle` icon, 16px, `color: c.muted`
- No shadow, no pulse animation — deliberately quiet so it doesn't compete with the capture FAB

### Behaviour
On tap: opens a modal bottom sheet containing the existing `SocraticScreen` content (the message list + input bar). The sheet is presented via a `react-native` `Modal` (not expo-router push) so it overlays without disturbing the tab navigator state.

**Topic selection logic (in `SocraticFab`):**
```
topicId = lastTappedClusterTopicId   // set by atlas tab via context/ref
       ?? user's top topic by capture count  // fetched from /api/memory/trends
       ?? null  // opens thread-less companion
```
The `lastTappedClusterTopicId` is stored in a lightweight React context (`SocraticContext`) that the atlas tab writes to when a cluster is tapped. Other tabs read it; it's cleared on close.

### No layout changes on individual screens
The FAB is injected at the `_layout` level — individual tab screens don't need modification.

---

## What is explicitly out of scope

- Embedding-based semantic similarity (no vector DB, no OpenAI embeddings) — term-vector cosine is sufficient given the fix to layout
- Comments UI on pulse feed
- Notifications UI
- User profile pages (clicking a handle opens a stub for now)
- Any changes to the backend similarity/edge generation logic

---

## File change summary

| File | Change |
|---|---|
| `mobile/app/(tabs)/index.tsx` | Replace `layoutGraph()` body with force-directed settle |
| `mobile/app/(tabs)/trends.tsx` | Full redesign: topic galaxy SVG replaces momentum bars |
| `mobile/app/(tabs)/_layout.tsx` | Replace drift slot with pulse; add `SocraticFab` overlay; add `SocraticContext` provider |
| `mobile/app/(tabs)/pulse.tsx` | New file: social feed screen |
| `mobile/contexts/SocraticContext.tsx` | New file: tiny context for cross-tab topic tracking |
| `src/app/api/social/feed/route.ts` | New file: paginated feed API route |
| `src/server/services/social.ts` | Add `getFeed()` function |
