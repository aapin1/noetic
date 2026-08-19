# Atlas home page improvements — design

Date: 2026-07-06
Scope: `mobile/app/(tabs)/index.tsx` (Atlas map screen), `mobile/app/companion/index.tsx`, companion backend (`src/server/services/companion.ts`, `src/server/cognition/llm.ts`, `src/app/api/companion/reply/route.ts`, `src/server/contracts.ts`), `mobile/lib/api.ts`.

## a) Top-right info panel

Problem: the only map-summary text today is `{N} points` alone in the bottom-left (`mapMeta` style, index.tsx:2453-2463) — isolated and easy to miss.

Fix: remove the bottom-left `mapMeta` block. Add a new panel anchored top-right, directly under the existing header buttons (Toolbar / theme toggle), rendered in the same fixed overlay as the header. Right-aligned mono text, one line per stat, low-emphasis styling consistent with the rest of the chrome (`rgba(236,236,236,0.2-0.5)` range, same as `mapMeta`/`focusBadgeText`).

Up to 5 lines, in this order, each hidden if not applicable:

1. `{N} points` — `nodes.length`. Always shown when `nodes.length > 0`.
2. `{N} topics` — count of clusters with `kind === 'topic'` (fallback to distinct topicIds across nodes if no topic-kind clusters exist).
3. `{N} connections` — `edges.length`. Hidden if 0.
4. `{N} tensions to explore →` — `contradictionCards.length` from `api.memory.intelligence()`. Hidden if 0 or not yet loaded. Tappable → `router.push('/(tabs)/mind')`.
5. One dynamic "most exciting" line, computed by priority:
   - If any friend in `api.social.pulse()` has a `latest[0]` captured within the last 24h: `"{displayName} just added something →"`. Tappable → `router.push('/(tabs)/pulse')`.
   - Else if `api.memory.trends()` has a theme in `shifts` with `delta > 0`, pick the top one: `"{topicName} is rising this week →"`. Tappable → `router.push('/(tabs)/trends')`.
   - Else omit this line entirely.

Data loading: three new parallel `useApiQuery` calls (`intelligence()`, `trends({ window: 'week' })`, `social.pulse()`) alongside the existing graph query, all independent/non-blocking. Lines 1-3 render as soon as graph data is in; lines 4-5 fade in individually as their queries resolve (no shared loading gate — a slow pulse/trends fetch never blocks the panel from showing points/topics/connections).

Visibility: panel shows only when `nodes.length > 0 && !showCapture && !drawerVisible`, and hides while the search bar, discovery bar, or focus badge occupies the same top-right/top area (same guards those already use).

## b) FAB breathing glow

Replace `fabRing` (index.tsx:1697-1708, 1844-1845, 2634-2637 — a bordered circle stepping 1.0→1.75 scale / 0→0.4 opacity in a hard back-and-forth loop) with a soft filled glow disc:

- Same node color (`MAP_NODE`) as a filled circle (no border), larger than the FAB (~1.6×), positioned behind it.
- Animate opacity 0 → ~0.22 → 0 and scale ~0.9 → 1.1 → 0.9, continuous loop, sine-eased, ~2.2s per direction (single `Animated.Value` driving both via interpolation, same pattern as today).
- No expanding-ring shape — an ambient pulse of light, not a blip.

## c) Multi-select → "open in companion"

Current flow (index.tsx): selecting 2-5 nodes in discover mode shows a pill with "`{N} selected`" + "`find connection →`"; tapping it sets `discoveryActive = true`, which drives a client-side-only computation (`discoveryResult`: shared topics, shared neighbors, direct edge) rendered in the side drawer. No LLM involved.

New flow:

1. Button label becomes `open in companion →`.
2. `onPress`: navigate to `/companion` with route params `contextIds` (comma-joined selected node ids) and `contextLabels` (comma-joined node labels, commas in labels stripped — they're only used for display), then call `clearDiscovery()` and `setToolMode('default')` so the map resets.
3. Remove `discoveryActive`, `discoveryResult`, `discoveryEdgeKeys`, `activateDiscovery`, and the drawer's "connection" result block (index.tsx:1273-1359 gate logic, 2490-2540ish JSX) — this local analysis path is fully superseded and becomes dead code. `isDiscoverySelected`-style selection highlighting (independent of `discoveryResult`) stays as-is.

Companion screen (`app/companion/index.tsx`):

- Read `contextIds`/`contextLabels` via `useLocalSearchParams`.
- If present: show a small chip row above the input — `regarding: {label A}, {label B}` — and two suggestion chips: "Find the connection" and "What's the tension between these ideas?". Tapping a chip sends that exact text via the existing `handleSend` path. Typing a custom question works the same way.
- Suggestion chips + regarding-chip are shown until the first message is sent in this screen visit, then hidden (local `useState` flag, not persisted).
- Every `reply()` call made during this visit (while `contextIds` were passed in) includes `contextItemIds` — not just the first — so follow-up questions in the same visit stay grounded.

Backend (message still lands in the single persistent companion thread — nothing new to persist beyond that):

- `companionReplySchema` (`src/server/contracts.ts`) gains `contextItemIds: z.array(z.string()).max(5).optional()`.
- `POST /api/companion/reply` passes `input.contextItemIds` through to `addCompanionReply`.
- `addCompanionReply` (`src/server/services/companion.ts`): if `contextItemIds` present, fetch those `capturedItem`s scoped to `where: { id: { in: contextItemIds }, userId: args.userId }` (ids not belonging to the user are silently dropped, not errored), select `rawText`/`keyIdea`/`contentItem.title`. Build a short focus block:
  ```
  --- FOCUS FOR THIS REPLY ---
  1. "title" — keyIdea
  2. "title" — keyIdea
  --- END FOCUS ---
  ```
  Pass it to `generateCompanionResponse` as a new optional `focusBlock` argument.
- `generateCompanionResponse` (`src/server/cognition/llm.ts`): when `focusBlock` is present, insert it into the system prompt right before the "Answer what the user asks" instructions, with a line telling the model to ground its answer specifically in those items while still having the full map for supporting context.
- `mobile/lib/api.ts`: `companion.reply(content, contextItemIds?)` includes `contextItemIds` in the POST body when present.

## d) Stuck "pressed" toolbar highlight

Root cause: the discover-mode toolbar icon's highlight is `toolMode === 'discover'` (index.tsx:668, `active && { backgroundColor: ... }`). Canceling a selection — the ✕ in the discovery bar (line 2421) or "clear & close" in the drawer (line 2534) — only calls `clearDiscovery()`, which resets `discoveryNodeIds`/`discoveryActive` but never `toolMode`. So the icon stays highlighted until the user taps it again.

Fix: both cancel call sites also call `setToolMode('default')` alongside `clearDiscovery()`. (Superseded/removed for c) — after the multi-select rework above, the drawer "clear & close" button no longer exists; the discovery-bar ✕ is the one remaining cancel path and gets the fix.)

## Out of scope / not touched

- Search mode's toggle-off (re-tapping the search icon) already correctly clears `toolMode` — confirmed by reading the code, no fix needed there.
- No changes to the Socratic (per-topic) companion thread.
- No changes to how many nodes can be selected (still capped at 5, `toggleDiscoveryNode`).
