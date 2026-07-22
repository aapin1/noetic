# Thin-capture flagging — design

**Date:** 2026-07-21
**Status:** approved, pending implementation plan

## Problem

When extraction produces little or nothing, the pipeline still drafts insights
from whatever it has — a title, an author, an `og:description`. The result reads
confident and says nothing. The ask-the-user fallback exists but almost never
fires, because the mobile screen decides whether content was extracted by
*guessing*:

```ts
// mobile/app/insight/[id].tsx — current
const legacyDesc = desc.length > 0 && desc.length <= 400 && !/^https?:\/\//i.test(desc) ? desc : null;
const hasAbout = !!(data.userContext?.trim() || data.summary?.trim() || legacyDesc);
```

`summary` is the LLM-cleaned excerpt. A page with a decent `og:description` and
**zero** body text produces a perfectly plausible `summary`, so `hasAbout` is
true and the prompt never appears — even though the pipeline never read the
content.

The client cannot do better today: `captureSummarySelect` deliberately omits
`bodyText` (an earlier `include` moved ~2MB per page over the wire), so the
client has no way to measure how much was actually extracted.

Measured against 13 real sources (see `docs/extraction-audit-2026-07-21.md`),
three captures had effectively no content and none of them prompted the user.

## Rule

New export in `src/server/metadata.ts`, beside `scoreContentConfidence`:

```ts
export function needsUserContext(args: {
  kind: CaptureKind;
  bodyWords: number | null;
  bodySource: string | null;
  userContext: string | null;
}): boolean;
```

Returns true when **all** of the following hold:

1. `kind === LINK`. `QUOTE` and `TEXT` captures are the user's own words;
   `IMAGE` captures carry vision-extracted content. Neither needs this prompt.
2. `userContext` is empty. The user has already answered — never ask twice.
3. Either:
   - `bodyWords < 50`, **or**
   - `bodySource === "description"` — the fallback blurb path. A YouTube video
     whose transcript failed stores the creator's description *as* body text;
     that description is often sponsor codes and social links, and can clear 50
     words while the pipeline has seen none of the video.

### Behaviour on the measured corpus

| source | bodySource | words | flagged |
|---|---|---:|---|
| NYT (paywall, 403 every tier) | — | 0 | **yes** |
| Reddit (403 JSON API) | — | 0 | **yes** |
| Apple Podcasts (show page) | body | 36 | **yes** |
| YouTube, transcript failed | description | any | **yes** |
| BBC article | body | 324 | no |
| YouTube ×3 (captions) | transcript | 1261–1707 | no |
| Substack ×3 | body | 1613–1966 | no |
| Ars Technica | body | 1336 | no |
| Medium | body | 1966 | no |
| arXiv PDF | pdf | 1964 | no |

## Where the signal lives

Add one column:

```prisma
model ContentItem {
  /// Word count of bodyText at extraction time. Lets the thin-content signal
  /// be computed without ever selecting the body itself.
  bodyWords Int?
}
```

Written wherever `bodyText` is written: the fresh-scrape create in `ingestUrl`,
the body-backfill update in `ingestUrl`, and `createManualContentItem`.

`captureSummarySelect` gains `bodyWords` and `bodySource` (two small scalars,
no size regression). `serializeCapturedItem` calls `needsUserContext` and adds
`needsContext: boolean` to `CapturedItemSummary`, so every surface reads one
authoritative value instead of re-deriving heuristics.

`bodyWords` is treated as `0` when null, because a row with no `bodyText`
genuinely has zero words. That makes ordering load-bearing: **the backfill must
run before or with the deploy**, or every pre-existing row with real body text
would flag until it does.

```sql
UPDATE "ContentItem"
SET "bodyWords" = array_length(regexp_split_to_array(trim("bodyText"), '\s+'), 1)
WHERE "bodyText" IS NOT NULL AND "bodyWords" IS NULL;
```

Requires `prisma generate`, `db push` on local **and** production, then the
backfill above.

## Surfaces

### Insight screen — `mobile/app/insight/[id].tsx`

Delete the `legacyDesc` / `hasAbout` guesswork in the auto-prompt effect and
the `legacyDescription` fallback in `aboutText`; drive both off
`data.needsContext`. Opening a flagged capture auto-opens the "what was this
about?" editor, including captures that look fine today because an
`og:description` produced a plausible summary.

The editor itself is unchanged, but must be verified end to end: typing, save,
cancel, the re-processing state, and the error path.

### Capture pill — `mobile/app/(tabs)/index.tsx`

When the capture response is flagged:

- status line `saved ✓` → `saved ✓ · needs your note`, in the attention tint
  rather than the neutral one
- primary action `insight →` → `add context →`
- `atlas →` unchanged

Two buttons, not three — the pill is narrow.

## Testing

Unit tests for `needsUserContext` pinned to the corpus above:

- flags at 0, 0, and 36 words
- does not flag at 324, 1261, 1966 words
- flags `bodySource: "description"` at any word count
- does not flag `QUOTE`, `TEXT`, `IMAGE`
- does not flag when `userContext` is present

Plus a `serializeCapturedItem` test asserting `needsContext` is surfaced.

Manual verification of the insight editor: type, save, cancel, save-with-error.

## Out of scope

- The ASR coverage gap (43s of a 10-minute video). Tracked separately in
  `docs/extraction-audit-2026-07-21.md` — the ASR path yields ~644 chars
  (~105 words), which clears this threshold by design.
- Changing `scoreContentConfidence`. It drives insight-drafting grounding and
  stays as is; `needsUserContext` is a separate, stricter question.
