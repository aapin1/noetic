# Archive folders redesign — design

Date: 2026-07-07
Scope: `mobile/app/(tabs)/memory.tsx` (main Archive screen), new `mobile/app/archive/[topicId].tsx` (folder drill-down), new `mobile/components/archive/*`, new `src/server/services/archive.ts`, new `src/app/api/archive/route.ts` + `src/app/api/archive/[topicId]/route.ts`, `mobile/lib/api.ts`, `mobile/types/api.ts`, `mobile/app/_layout.tsx`.

## Problem

The current Archive tab (`mobile/app/(tabs)/memory.tsx`, internally `LogScreen`) is a flat, chronological, text-only list of every capture (`CaptureRow`, `memory.tsx:19-86`). No grouping, no thumbnails, no way to browse by subject. It's being fully replaced with a topic-folder browser: general topics as top-level folders, specific topics as sub-folders where applicable, and entries rendered as files with their thumbnail/author/date.

## Data model reality check

Topics are a flat multi-tag system, not a real tree: `CapturedItemTopic` (`prisma/schema.prisma:569-578`) has no parent/child column. A topic's "general" vs "specific" kind is derived purely by name membership in the fixed `GENERAL_TOPICS` whitelist (`src/server/cognition/generalTopics.ts:14-19`, 26 coarse fields) — a capture can carry multiple topic rows, each independently general or specific, with no explicit link between a specific topic and "its" general parent. The design below derives folder structure from this flat data via co-occurrence, per the decisions made during brainstorming:

1. **Multi-home**: an entry with topics `{Philosophy (general), Psychology (general)}` appears in both the Philosophy and Psychology folders independently.
2. **Top-level folders = general topics only.** Specific topics never get their own top-level folder *except* as a fallback (case 4).
3. **Real-filesystem nesting**: within a general folder, an entry with ≥1 specific topic lives only inside its specific-topic sub-folder(s) (multi-homed across those if it has more than one specific topic), never loose at the general folder's top level. An entry with the general topic and *no* specific topic sits directly in the general folder as a file.
4. **Specific-topic fallback**: an entry with a specific topic but *no* general topic at all becomes its own top-level folder, keyed by that specific topic (leaf, no sub-folders).
5. **Uncategorized safety net**: an entry with *zero* topics (classification hasn't run yet) goes into a single reserved "Uncategorized" top-level folder, so nothing is ever silently hidden. This is separate from case 4.

A folder's `count` is always the number of *distinct* entries tagged with that folder's topic — not a sum of its sub-folder counts (an entry with two specific topics under the same general is multi-homed across two sub-folders but only counted once at the general level).

## Backend

### `src/server/cognition/generalTopics.ts`
No changes — reused as-is.

### `src/server/services/archive.ts` (new)

Two exported functions, both scoped to `userId` with no artificial row cap (folder counts must reflect the true total, unlike the 80-200 item windows used elsewhere for feeds/graphs):

**`listArchiveFolders({ userId, db? })`** — single query:
```ts
db.capturedItem.findMany({
  where: { userId },
  select: { id: true, capturedAt: true, topics: { select: { topicId: true, weight: true, topic: { select: { id: true, name: true, slug: true } } } } },
})
```
In-memory aggregation (one pass): for each item, split its topic rows into `generalRows`/`specificRows` via `isGeneralTopic(row.topic.name)`. If `generalRows.length > 0`, add the item to a folder keyed by each general topic's id (kind `'general'`). Else if `specificRows.length > 0`, add it to a folder keyed by each specific topic's id (kind `'specific'`, fallback case). Else add it to the reserved `'uncategorized'` folder (sentinel id, kind `'uncategorized'`). Each folder tracks a `Set<itemId>` (for `count`) and a running max `capturedAt` (for `latestActivity`). Returns:

```ts
type ArchiveFolderSummary = {
  topicId: string; // 'uncategorized' for the safety-net bucket
  name: string;
  slug: string;
  kind: 'general' | 'specific' | 'uncategorized';
  count: number;
  latestActivity: string; // ISO
};
```

**`getArchiveFolder({ userId, topicId, db? })`**:
- `topicId === 'uncategorized'`: query items with `topics: { none: {} }`, serialize with the existing `serializeCapturedItem` + `leadInsight` pattern from `listCaptures` (`src/server/services/cognition.ts:1068-1095`), return `{ name: 'Uncategorized', kind: 'uncategorized', subfolders: [], entries }`.
- Otherwise, look up the `Topic` row by id, determine `kind` via `isGeneralTopic(topic.name)`.
  - **`kind === 'specific'`** (leaf, reached either as a fallback top-level folder or as a sub-folder tap): query items where `topics.some({ topicId })`, serialize all of them as `entries`, `subfolders: []`. Same response shape regardless of how the client navigated here — no context needed.
  - **`kind === 'general'`**: query items where `topics.some({ topicId })`, including all of each item's topic rows. Partition: items whose OTHER topic rows include ≥1 specific topic get grouped into `subfolders` (grouped by each specific topic's id, multi-homed the same way as the top-level aggregation, with per-subfolder `count`/`latestActivity`); items with no specific topic become `entries` directly, serialized via `serializeCapturedItem`.
- Both entries and subfolders sort by recency by default (`capturedAt`/`latestActivity` desc) — the client only re-sorts the top-level (root) folder list, not drill-down screens (filters are root-only per the request).

Response type:
```ts
type ArchiveFolderDetail = {
  topicId: string;
  name: string;
  kind: 'general' | 'specific' | 'uncategorized';
  subfolders: ArchiveFolderSummary[];
  entries: CapturedItemSummary[]; // same shape as listCaptures() items (CaptureSummary on mobile)
};
```

### API routes (new)
- `src/app/api/archive/route.ts` — `GET`: `requireRequestUserId` + `listArchiveFolders`. Mirrors `src/app/api/captures/route.ts:34-40`.
- `src/app/api/archive/[topicId]/route.ts` — `GET`: `requireRequestUserId` + `getArchiveFolder({ userId, topicId: params.topicId })`. Mirrors `src/app/api/captures/[id]/route.ts:6-10`. 404 (via `handleRoute`'s existing not-found convention) if `topicId` doesn't resolve to a real topic and isn't `'uncategorized'`.

### Mobile types/client
- `mobile/types/api.ts`: add `ArchiveFolderSummary` and `ArchiveFolderDetail` mirroring the server shapes above (reusing `CaptureSummary` for `entries`).
- `mobile/lib/api.ts`: add `archive: { list() { return request<{ folders: ArchiveFolderSummary[] }>('/api/archive'); }, get(topicId: string) { return request<ArchiveFolderDetail>(\`/api/archive/${topicId}\`); } }`, next to the existing `captures`/`memory` blocks (`mobile/lib/api.ts:185-248`).

## Mobile UI

### New shared components (`mobile/components/archive/`)

**`FolderIcon.tsx`** — a small custom SVG/View-based folder silhouette (front panel + back tab), built only from theme tokens (`c.elevated` fill, `c.border` stroke) — no new color, light/dark aware, no photorealistic gradient. Two sizes: default (grid tile) and none needed beyond that (sub-folders reuse the identical component/size — "sub-folder looks the same as the main folder, just a different title").

**`FolderTile.tsx`** — `FolderIcon` + folder name (`Text variant="label"`, matching the existing uppercase mono-caps convention used for eyebrows elsewhere) below it, plus an entry-count `Badge variant="count"` in the corner. Pressable, navigates to `/archive/${topicId}`.

**`FolderGrid.tsx`** — wraps an array of `ArchiveFolderSummary` in a responsive flex-wrap grid of `FolderTile`s (3 columns, matching Finder/Explorer icon-grid density). Used by both the root Archive screen and any drill-down screen that has sub-folders.

**`FileRow.tsx`** — one entry: left-aligned 44×44 rounded-corner thumbnail. Resolved as `item.mediaUrl` when `kind === 'IMAGE'`, else `item.contentItem?.imageUrl` (LINK articles/YouTube); if neither resolves to a URL (thin-extraction LINK, or a TEXT/QUOTE capture with no image), render a plain document-outline placeholder icon in the same slot instead. Title (serif, matching `CaptureRow`'s `rowTitle` style), author/site name below in muted mono small caps (`item.contentItem?.authorName ?? item.contentItem?.sourceName`), and the capture date (mono, right-aligned), using `Card variant="hairline"` rows exactly like the current `CaptureRow` but with the thumbnail added. Pressable, navigates to `/insight/${item.id}` — unchanged destination.

**`FileList.tsx`** — thin wrapper rendering `FileRow` per entry with the existing `borderBottomColor` hairline separators.

### `mobile/app/(tabs)/memory.tsx` (rewritten)
- Fetches `api.archive.list()` instead of `api.captures.list({ limit: 80 })`.
- Header: wordmark changes from `"log"` to `"archive"` (aligns with the tab label, `mobile/app/(tabs)/_layout.tsx:114-119`, which already says "archive" — this was a pre-existing mismatch). Info modal copy updated to describe the folder browsing model instead of "chronological record."
- Below the header: a filter row (4 options — Recent, Alphabetical, Largest → Smallest, Smallest → Largest) as a horizontal set of small pressable labels/pills (reusing `Badge variant="pill"` styling, `selected` state marks the active one), default `Recent`. Purely client-side re-sort of the already-fetched `folders` array — no refetch:
  - Recent: `latestActivity` desc.
  - Alphabetical: `name` localeCompare asc.
  - Largest → Smallest / Smallest → Largest: `count` desc/asc.
- Body: `FolderGrid` of all folders (including `'specific'`-kind fallback folders and the `'uncategorized'` bucket if non-empty, all rendered identically as folder tiles — kind isn't visually distinguished, only entry contents differ).
- Empty state (`(folders?.length ?? 0) === 0`): same centered mono copy pattern as today, updated text.
- Loading state: skeleton grid of folder-tile placeholders instead of skeleton rows.
- Pull-to-refresh and `useFocusEffect` refetch-on-focus behavior (`memory.tsx:98-101`) preserved as-is.
- Old `CaptureRow` component and its flat-list rendering are deleted entirely.

### `mobile/app/archive/[topicId].tsx` (new)
- Reads `topicId` via `useLocalSearchParams`, fetches `api.archive.get(topicId)`.
- Header matches the existing back-chevron pattern from `mobile/app/insight/[id].tsx:104-113` (back arrow + centered mono small folder name, no info button).
- Body: if `subfolders.length > 0`, render `FolderGrid` for them (tapping one pushes `/archive/${subTopicId}` — same screen recurses, which is what gives sub-folders "the same look" for free); then `FileList` for `entries` below (a general folder with only files and no sub-folders just skips the grid section).
- Loading/empty states mirror the root screen's, scoped to this folder ("nothing filed here yet" vs. root's "nothing here yet").
- No filter row here — filtering is root-only per the request ("on the main archive page, be able to filter the folders").

### `mobile/app/_layout.tsx`
Register the new route: `<Stack.Screen name="archive/[topicId]" options={{ presentation: 'card' }} />`, next to the existing `insight/[id]` entry (`_layout.tsx:35`).

## Out of scope

- No Prisma schema changes — folder structure is entirely derived at read time from existing relations.
- No changes to how topics are classified/assigned (`src/server/cognition/topics.ts`) or to the Map screen's clustering.
- No server-side sort/pagination for the root folder list — sorting is client-side over the full fetched set, and per-user folder/entry counts are assumed small enough (personal capture archive) that this stays cheap; revisit if that assumption breaks.
- No search/filter *within* a folder's file list — only the 4 top-level folder sort options requested.
- `mobile/app/topics/` and `mobile/app/content/` are pre-existing empty route directories, unrelated to this work — left untouched.
