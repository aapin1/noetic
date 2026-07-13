# Topic panel, pulse card, and topic momentum — design

Date: 2026-07-13
Branch: `worktree-topic-panel-momentum-fixes`

## Problem

Three user-reported issues on the Atlas and Pulse screens, plus one finding that
reframes the third.

1. **"take a position" errors.** Tapping a topic/sub-topic on the map opens the
   right-side drawer, whose "take a position →" button produces an error.
2. **Pulse card carries a useless line.** Every friend card leads with
   "Top topics: no dominant topics yet. Core sources: …", which is noise.
3. **The Atlas info-panel looks frozen.** After adding four philosophy captures,
   the panel still read "ai rising".

## Findings

### "take a position" routes to a viewer, not a creator

`mobile/app/(tabs)/index.tsx:3456` routes to `/position/${topicId}`. That screen
(`mobile/app/position/[topicId].tsx`) *views an existing position*: it calls
`api.positions.getByTopic(topicId)`, and the backend
(`src/app/api/positions/[topicId]/route.ts:9-15`) throws a 404
`POSITION_NOT_FOUND` whenever the user has no position for that topic — the
normal case on first tap. The screen then renders "Position not found."

`mobile/app/position/create.tsx` already exists, already takes exactly
`{ topicId, topicName, captureCount }` (the three values the drawer holds), and
already calls `api.positions.create`. Nothing in the app links to it.

`mobile/app/(tabs)/mind.tsx` has no `useLocalSearchParams`, so **there is no
topic-scoped route into Mind.** Scoping "take a position" to a topic within Mind
is not available without new plumbing, and is out of scope.

### Pulse already refreshes silently

`mobile/app/(tabs)/pulse.tsx:185` is
`useFocusEffect(useCallback(() => { void refetch(); }, [refetch]))`, backed by
the stale-while-revalidate cache in `mobile/hooks/useApiQuery.ts`. It refetches
on every tab focus and repopulates in place without a spinner. **No change
required.**

The stale-feeling content is `identitySummary`, which
`recomputeProfileSummary()` never recomputes from the capture path — it is only
called from ranking, account, social, and logging flows. That is why it sits at
"no dominant topics yet". Removing the line from the card makes this moot.

### The info-panel is not stale — the momentum metric is wrong

The panel's refresh plumbing is already correct:

- `refetchMapData()` fires after every capture (`index.tsx:2523`) and after
  deletes (`index.tsx:2233-2236`).
- `useFocusEffect(refetchMapData)` fires on every tab focus (`index.tsx:1333`).
- `getMemoryTrends` is computed live server-side, with no cache.

The bug is the formula in `src/server/services/memory.ts:384-395`:

```
delta = recent(last 7d) - prior(7–30d ago)
shifts = topics with delta != 0, sorted by |delta|
```

This compares a **raw count over a 7-day window against a raw count over a
23-day window** — different-length windows, so the numbers are not comparable.
Worse, the sort is stable over a list pre-sorted by `total` descending, so ties
break **toward the topic with the most captures overall**. A user with 12 AI
captures this week and 8 before gets `delta = +4`; four fresh philosophy
captures also give `delta = +4`; AI wins the tie *because it is already the
biggest topic*. That is the exact opposite of "rising".

`excitingLine` (`index.tsx:1369-1385`) then re-sorts client-side by raw `delta`
and inherits the same bias.

## Design

### 1. Route "take a position" to the creation screen

In the drawer's cluster detail (`mobile/app/(tabs)/index.tsx:3455-3461`), replace
the route to the viewer with a route to the existing creation screen:

```ts
router.push({
  pathname: '/position/create',
  params: {
    topicId: drawerCluster.topicId,
    topicName: drawerCluster.name,
    captureCount: drawerCluster.count,
  },
} as never)
```

The error disappears at its root, the button does what it says, and the created
position surfaces in Mind's convergence region — so the user still reaches Mind,
with a position to show. `/position/[topicId].tsx` stays as-is; it remains the
viewer for positions that already exist.

**Not doing:** rerouting to an unscoped `/(tabs)/mind`. It would silence the
error but leave the app with no way to take a position from a topic at all.

### 2. Rank topic momentum by rate lift

Add a shared, exported helper to `src/server/services/memory.ts`:

```ts
export function rankTopicMomentum(
  items: { capturedAt: Date; topics: { topicId: string; name: string }[] }[],
  opts: { recentDays: number; priorDays: number; now?: number },
): { topicId: string; name: string; recent: number; prior: number; lift: number }[]
```

The input takes a **normalized** topic shape (`{ topicId, name }`), because the
two callers hold different shapes: `getMemoryTrends` has raw Prisma rows
(`topics: { topicId, topic: { name } }[]`, `memory.ts:347`) and must map them in,
while `getMemoryGraph` nodes already expose `{ topicId, name, kind }`
(`memory.ts:21,258`) and can be passed through directly. `now` is injectable so
tests are not clock-dependent.

Scoring, per topic:

- `recentRate = recent / recentDays` (captures per day in the recent window)
- `priorRate = prior / (priorDays - recentDays)` (captures per day in the prior window)
- `lift = (recentRate + SMOOTHING) / (priorRate + SMOOTHING)` with
  `SMOOTHING = 1 / priorDays`, so a topic with no prior history gets a large but
  finite lift rather than dividing by zero.
- **Floor:** a topic needs `recent >= MIN_RECENT` (2) to be ranked at all, so a
  single capture in a brand-new topic cannot hijack the line.
- Sort by `lift` descending; **break ties on the most recent capture timestamp**,
  never on total volume.

Because both rates are per-day, the 7-day and 23-day windows become comparable.
Philosophy going 0 → 4-in-a-week now outranks AI going 8-over-23-days →
12-in-a-week.

`getMemoryTrends` uses this helper and gains one new field on its response:

```ts
rising: { topicId: string; name: string } | null   // highest-lift topic with lift > 1
```

Existing `shifts` / `themes` / `recurring` / `sparkline` keep their current shape
so nothing else that reads the trends response breaks.

### 3. Info-panel reads `rising` from the server

`excitingLine` (`mobile/app/(tabs)/index.tsx:1369-1385`) drops its client-side
`shifts.filter(...).sort(...)` and reads `trendsData.rising` directly:

```ts
if (trendsData?.rising) {
  return {
    text: `${trendsData.rising.name} rising →`,
    route: `/archive/${trendsData.rising.topicId}`,
  };
}
```

The friend-activity branch above it is unchanged. **No new refetches, no polling,
no cache invalidation** — the existing plumbing already revalidates correctly, and
adding redundant refreshes would paper over the real cause rather than fix it.

### 4. Pulse card shows info-panel-style stats

`getPulse` (`src/server/services/social.ts:405-447`) already fetches each
friend's `graph.nodes`, which already carry `capturedAt` and `topics` in the
normalized shape the helper wants. Run `rankTopicMomentum` over those nodes with
the **same week window the info panel uses** (`recentDays: 7, priorDays: 30`) to
derive the friend's rising topic at **zero extra database cost**, and add to each
friend entry:

```ts
rising: { topicId: string; name: string } | null
```

`captureCount` and `map.clusters` are already on the payload, so points and
fields need no backend change.

**Known approximation:** `getPulse` fetches a friend's nodes capped at
`PULSE_MAP_NODES` and newest-first, so for a very prolific friend the prior
window may be truncated, inflating their lift. This is accepted rather than
fixed: correcting it would mean an extra per-friend trends query (turning the
pulse into 2N queries), and the failure mode is a friend's rising topic being
slightly over-eager — not wrong data. The user's own info panel goes through
`getMemoryTrends`, which queries the full window and is unaffected.

In `mobile/app/(tabs)/pulse.tsx`, delete the `identitySummary` block (lines
81-85) and render an info-panel-style line in the same mono-small muted type:

```
12 points · 4 fields · philosophy rising
```

Built from `friend.captureCount`, `friend.map.clusters.length`, and
`friend.rising`. Segments are omitted when empty (a friend with no rising topic
shows `12 points · 4 fields`). Pluralization matches the info panel
(`point`/`points`, `field`/`fields`).

The existing `topRegions` caption under the mini-map stays as-is — it names the
biggest fields, which the stat line does not.

`buildIdentitySummary` and `profile.identitySummary` are **left in place** on the
backend; only the pulse card stops rendering the field. Removing the backend
field is a larger change than this task warrants, and `src/server/core.test.ts`
still covers it.

## Data flow

```
capture created / node deleted / Atlas tab focused
  └─ refetchMapData()                       (already exists, unchanged)
       ├─ api.memory.trends({window:'week'})
       │    └─ getMemoryTrends
       │         └─ rankTopicMomentum  ──► rising ──► InfoPanel "philosophy rising →"
       └─ api.social.pulse()
            └─ getPulse
                 └─ rankTopicMomentum (per friend, over already-fetched nodes)
                      └─ friend.rising ──► FriendCard "12 points · 4 fields · philosophy rising"

Pulse tab focused
  └─ refetch()                              (already exists, unchanged)
```

`rankTopicMomentum` is the single source of truth for "what is rising" — the info
panel and the pulse card cannot disagree.

## Testing

Unit tests (`vitest`, alongside the existing `src/server/*.test.ts` suite):

- `rankTopicMomentum`:
  - A low-volume topic with a recent burst outranks a high-volume topic with a
    proportionally smaller increase (the reported "ai rising" bug, as a
    regression test).
  - A topic with `recent < MIN_RECENT` is excluded.
  - A topic with no prior captures gets a finite lift (no division by zero).
  - Ties on lift break toward the most recent capture, not the largest total.
  - Empty input returns an empty array.
- `getMemoryTrends`: returns `rising: null` when no topic clears the floor;
  returns the highest-lift topic otherwise; `shifts`/`themes`/`recurring` keep
  their existing shape.
- `getPulse`: each friend entry carries `rising`, derived from that friend's own
  nodes; `null` when they have too few recent captures.

Manual verification:

- Tap a topic on the map → "take a position →" opens the creation screen
  pre-filled with the topic's name and capture count; saving succeeds; tapping
  the same topic again and opening the viewer shows the saved position.
- Add several captures in a new topic → the info panel's rising line changes to
  that topic without an app restart.

## Out of scope

- Any change to Pulse's refresh behaviour (already correct).
- Topic-scoped deep links into Mind (`mind.tsx` takes no params).
- Removing `identitySummary` from the backend.
- Calling `recomputeProfileSummary()` from the capture path.
