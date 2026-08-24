# Account connections — design

**Date:** 2026-08-23

## Problem

Most of what a person has already read and watched lives in accounts they
keep elsewhere: a Letterboxd diary, a Goodreads shelf, a Readwise library.
Bulk import (`/import`) covers bookmark files; nothing covers these. And a
file is a one-shot — once connected, an account should keep feeding the map
without the person doing anything again.

Mneme maps *thinking*, not activity. "Watched X, 4 stars" fifty times over
makes fifty near-identical nodes, flattens the map, and burns LLM spend. The
design question is therefore less "which feeds" than "which sentences".

## What was verified (2026-08-23, live requests)

| Source | Access | What it carries | Verdict |
|---|---|---|---|
| Letterboxd `letterboxd.com/{user}/rss/` | public, no UA needed | 50 diary entries + 50 lists; `letterboxd:*` fields, rating, watched date, TMDB id, full review HTML in `description`; guid prefix `letterboxd-review-` vs `letterboxd-watch-` tells reviewed from bare | **ship** |
| Goodreads `goodreads.com/review/list_rss/{id}?shelf=read` | public, no key; 100/page, `?page=N` works | `user_review` (HTML), `user_rating` (0 = unrated), `user_read_at`, `book_description`, author, ISBN, cover | **ship** |
| Readwise `GET /api/v2/export/` | token from readwise.io/access_token; `Authorization: Token …`; `updatedAfter` + `pageCursor` | every highlight with the person's `note`, grouped by book; token check `GET /api/v2/auth/` → 204 / 401 `{"detail":"Invalid token."}` | **ship** |
| AniList GraphQL | public, no auth, 30 req/min today | `notes` per entry; custom lists repeat entries (dedupe by entry id); only the list query says "Private User" | **ship** (words) |
| Trakt `/users/{slug}/comments/all/all` | app `trakt-api-key` (free app, env `TRAKT_CLIENT_ID`), public profiles only | every comment/review the person wrote, with the media and `user_stats.rating` | **ship** (words) — fails closed with a sentence until the client id is set |
| Hardcover GraphQL | the person's own token (`hardcover.app/account/api`), nothing public | `user_books` with `has_review`: `review_raw`, rating 0–5, dates, book | **ship** (words) |
| Raindrop `bg.raindrop.io/rss/public/{id}` | public collection, redirects to the collection's feed; 404 = private/unknown; 50 newest | link, title; `description` is the note *or* the auto-excerpt, indistinguishable | **ship** (link mode — the page is read, the description is not claimed as words) |
| Instapaper per-section RSS | the secret URL is the credential (web → section → Download → RSS) | original article links + auto-excerpt; no notes or highlights | **ship** (link mode) |
| YouTube `feeds/videos.xml?playlist_id=` | any public/unlisted playlist; likes (`LL`) and history 404 | 15 newest videos | **ship** (link mode — captions become the transcript) |
| YouTube liked / history, Substack reader side, Kindle, Spotify, Strava, Pocket | OAuth-only, impossible, forbidden, or dead | — | no |

Two facts that shaped the build: Letterboxd's HTML pages (profile *and* film
pages) 403 from datacenter IPs, so the feed must be the whole source of
truth — nothing is scraped. And Goodreads resolves `goodreads.com/{vanity}`
and `/user/show/{id}-slug` with a 301 whose `Location` carries the numeric
id, so nobody has to find their id.

## Two kinds of feed

A feed is either **words** — the person wrote something, and that text is the
substance — or **curation** — the person kept a page (saved it, liked it,
playlisted it) and the page's own content is the substance. Words feeds are
built from the feed without scraping. Curation feeds run each link through
the ordinary capture pipeline, exactly as a pasted import does: article
body, captions, the lot. A `ProviderItem.mode` of `"link"` is the switch.

## The rule: only words reach the map (words feeds)

A synced entry becomes a capture **only when the person wrote something**:

- Letterboxd: a diary entry with review text (guid `letterboxd-review-…`).
  Lists are ignored. Bare watches are counted, not captured.
- Goodreads: a `read`-shelf book with non-empty `user_review`.
- Readwise: every highlight is something the person chose to keep, and its
  `note` is something they wrote; both count as words. Highlights are grouped
  **one capture per book per sync**, not one per highlight, so a 3,000-
  highlight library becomes a few hundred nodes rather than thousands.

"Words" means at least two alphabetic words after stripping HTML — an
emoji-only review is a reaction, not a thought.

Bare ratings are **dropped** rather than stored or weighted. The argument for
keeping them as a "taste signal" is real, but nothing in the app consumes such
a signal today, and a speculative table for it is exactly the kind of parallel
machinery this project avoids. If a bare entry later gains a review, the next
sync picks it up — the ledger keys on the entry id, not on "seen".

The rating does ride along when there *is* a review: it becomes the first
line of the capture's `reaction` (`★★★★½`), where the insight screen already
shows "you said". This keeps it visible without feeding stars into embeddings.

## How a synced entry becomes a capture

Every provider normalises to one shape:

```ts
type ProviderItem = {
  externalId: string;           // stable per-entry id, e.g. "letterboxd-review-1425602988"
  title: string;                // "Face/Off (1997)"
  url: string;                  // the person's review/entry page — unique per user, so safe as canonicalUrl
  words: string;                // review text / notes — plain text, HTML stripped
  quote?: string;               // Readwise only: the highlights themselves
  description?: string;         // book blurb (Goodreads) — content context, never the person's words
  author?: string;
  imageUrl?: string;
  rating?: string;              // "★★★★½" — display only
  occurredAt: Date;             // watched / read / highlighted date, never in the future
};
```

The capture is then built **without scraping**:

1. `createManualContentItem` makes (or reuses by `canonicalUrl`) a
   `ContentItem` with the title, blurb, author, cover, and site name.
2. `captureItem` runs with two new payload fields: `contentItemId` (skip the
   extraction ladder entirely) and `origin` (provenance). For Letterboxd and
   Goodreads the kind is `LINK` with `reaction` = rating line + review. For
   Readwise the kind is `QUOTE` with `text` = the highlights and `reaction` =
   the notes. This matches how the insight screen already renders each kind:
   LINK hides `rawText` and shows `reaction` as "you said"; QUOTE shows
   `rawText` as the substance.
3. `capturedAt` is backdated to `occurredAt`. Syncing a year of reading must
   not look like a hundred captures today — it would distort momentum,
   trajectory fatigue, streaks, and "today". Dates are clamped to `now`.

Cost: no extraction, one embedding, one classification, one deferred
insight-polish per capture — the cheapest path in the pipeline. A capture
still passes through the shared `capturePipeline` semaphore on two lanes,
exactly like import, so a sync can never take more than 2 of 8 slots from
live captures.

## Data model

```prisma
enum ConnectionProvider { LETTERBOXD GOODREADS READWISE ANILIST TRAKT HARDCOVER RAINDROP INSTAPAPER YOUTUBE }

model Connection {
  id           String   @id @default(cuid())
  userId       String
  provider     ConnectionProvider
  /// What the person typed, normalised: a username or a numeric id.
  handle       String
  /// Display label — "Dave Vis", "Otis's shelf". Null for token providers.
  label        String?
  /// Readwise token, AES-256-GCM under a key derived from NEXTAUTH_SECRET.
  secret       String?
  /// Provider cursor (Readwise updatedAfter). Null = full pass.
  cursor       String?
  status       ConnectionStatus @default(OK)
  lastError    String?
  lastSyncedAt DateTime?
  /// Tally of the last sync, for the screen: { seen, withWords, mapped, failed }.
  lastSync     Json?
  syncingSince DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  items        ConnectionItem[]
  @@unique([userId, provider])
  @@index([lastSyncedAt])
}

/// Ledger: which provider entries have been handled, and which capture each
/// became. Keyed on the provider's own id, so a sync is idempotent across
/// restarts and a deleted capture is not re-created (the row stays, pointing
/// at nothing).
model ConnectionItem {
  id             String   @id @default(cuid())
  connectionId   String
  externalId     String
  capturedItemId String?
  createdAt      DateTime @default(now())
  @@unique([connectionId, externalId])
}

// CapturedItem gains:
//   /// Where the capture came from: null (by hand), "import", or a provider.
//   origin String?
```

One connection per provider per user — a second Letterboxd account is a
decision nobody should be asked to make. Connection secrets live in scalar
columns, never in `UserPreference.preferences` (which is replaced wholesale).
The key is derived from `NEXTAUTH_SECRET` with HKDF so there is nothing new
to configure in Render.

## Sync pacing

- **On connect:** validate, save, and start a first sync immediately in the
  request process (fire-and-forget, like import). The screen polls
  `GET /api/me/connections` every 2.5 s while `syncingSince` is set. Cap
  **100 captures** on a first sync.
- **Ongoing:** a second Render cron, `mneme-connections`, ticks hourly and
  POSTs `/api/connections/sync` under the same shared-secret scheme. The job
  takes a `connections:hourly` lease, picks connections whose `lastSyncedAt`
  is older than **20 hours** (so each is refreshed about daily, and a full
  day never races the fixed-hour schedule), oldest first, up to 150 per tick,
  and syncs them with 2 connections in flight. Cap **40 captures** per
  connection per tick. Readwise uses `updatedAfter` so ongoing pulls are a
  page or two; Letterboxd and Goodreads fetch their small feeds whole and
  the ledger makes them idempotent.
- **Failures:** a provider error marks the connection `ERROR` with a human
  sentence and still advances `lastSyncedAt`, so a broken account is retried
  daily, not hourly. The next good sync clears it.
- **Manual:** one "check now" action per connection, rate-limited to 6/hour.
  It exists so that a failure state has a one-tap retry.

## The screen

`Settings → Account → Connections` (row after Import), screen
`mobile/app/connections.tsx`. Three rows, one per provider. Each row is
either:

- **unlinked:** a single underline `Input` and a `connect` button. The field
  accepts whatever the person has — a username, a profile URL, a pasted
  token — and the server sorts it out. A hint in monoSmall says where to get
  it (`readwise.io/access_token`).
- **linked:** the label, a lowercase status line (`checked 2h ago · 12 on
  your map`, or `syncing…`, or the error sentence), `check now`, and
  `disconnect`.

Disconnecting deletes the connection and its ledger; captures already on the
map stay, and the confirmation says so.

Failure copy says what to fix:

- `couldn't find a letterboxd called "x" — check the spelling`
- `that goodreads shelf is private — make your "read" shelf public in goodreads settings, then try again`
- `readwise didn't accept that token — copy it again from readwise.io/access_token`
- `letterboxd isn't answering right now — try again in a bit`

Discovery, without touching onboarding: the Atlas empty state gains a line
(`read on goodreads or letterboxd? bring it over →`), the Import screen
mentions connections in its hint, and a whisper `connections-intro` fires
once after the person's fifth link capture. Zero-step signup stays zero-step.

## What ships — three doors

**1. Accounts (27).** One `Provider` interface, a username or token each,
refreshed daily by the cron. Words feeds: Letterboxd, Goodreads, Readwise,
Hardcover, Trakt, AniList, Kitsu, Steam reviews, Backloggd, RAWG, Bookwyrm,
ListenBrainz pins, Zotero notes. The person's own writing (TEXT captures,
`mode: "text"`): Bluesky, Mastodon, Hacker News, Reddit comments, Tumblr,
Are.na text blocks. Kept pages (`mode: "link"`, read by the pipeline):
Medium and Substack (their own articles), Pinboard, GitHub stars, Raindrop,
Instapaper, YouTube playlists, Bandcamp purchases. One connection per
provider per user. Reddit turns datacenter IPs away, so it is a
*device-fed* provider: the app fetches the feed itself and posts the body
(`Provider.deviceFeed` / `parse`, `POST /api/me/connections/reddit {feedText}`).

**2. Files (25 formats, `src/server/imports/`).** Any export goes through one
door — `parseImportFile` detects the format by header or filename, opens
zips, and returns the same `ProviderItem` shape: Goodreads, StoryGraph,
LibraryThing, Bookwyrm and Readwise CSVs; Kindle "My Clippings.txt" and the
notebook JSON the sign-in produces; Letterboxd zip/CSVs; IMDb ratings;
Netflix "Download all" and GDPR CSVs; MyAnimeList XML; Grouvee; RateYourMusic;
markdown/text notes (Obsidian, Notion, Bear — front matter read); Day One;
Evernote .enex; Google Keep; X/Twitter archive; Threads; YouTube Takeout
(watch history, playlists incl. liked, comments); Raindrop, Instapaper and
Pocket CSVs; browser bookmarks; a pasted list of links. The screen first
*inspects* (`POST /api/me/import/inspect` → formats, rows with words, bare
rows) and asks its one question: *also bring the N you didn't write about?*
— default on when the file has no words at all (Netflix, IMDb), off
otherwise. Bare rows become captures only once the **work resolver**
(`imports/resolve.ts`, keyless: Wikipedia with `hastemplate:` bias and a
year check, Open Library, AniList, Steam store) finds a page to read; catalogue
links (imdb, goodreads…) that don't extract are the fallback, not the first
choice.

**3. Sign in inside mneme (5).** For places with no feed and no export
button: Kindle notebook, Goodreads full library (private notes, private
shelves), Netflix viewing activity, Crunchyroll history, YouTube likes. A
WebView opens the site; the person logs in as usual, on the phone; when the
URL says they're in, a script served by the backend
(`GET /api/me/connections/session/{target}`) runs in the page, fetches their
own data with the page's own cookies, and posts it back as a file that goes
through the import door. Credentials never reach mneme; scripts live on the
server so a selector change is a deploy, not a release. This is the honest
version of what Shelf does with a credential-holding scraper farm. Needs
`react-native-webview` (installed, 13.16.1) and therefore a dev-client
rebuild; the require is guarded so older builds explain instead of crashing.
Unverified on a device from here.

Deliberately not built: Spotify (5-user cap), Strava (ToS), Pocket (dead),
Substack reader side / Disney+ / Hulu / Max / Apple TV+ (nothing to read),
Last.fm / Discogs / Plex / Jellyfin / Simkl / TMDB (activity only, or keys
and OAuth for no words), Audible and Prime Video sessions (the most brittle
scrapes for no words).

## Ask me first, or add on their own

One decision per person, not per account: `UserPreference.connectionsMode`,
**ASK** (default) or **AUTO**, chosen with a two-way control at the top of the
Connections screen once anything is connected. Onboarding stays zero-step.

In ASK mode a sync *stages* finds: the ledger row is written `PENDING` with
the serialised item in `payload` (one payload per item; a Readwise item
spanning several highlight rows keeps it on the first), so "add" never has to
refetch. Nothing reaches the map. Next time the Atlas is focused with finds
waiting — and nothing else is speaking — the capture pill's glass-and-cat
idiom slides in from the right: *"letterboxd found 9 things you wrote
about"*, the first title, and two answers. **add →** maps them in the
background through the same path AUTO uses (the pill shows "reading &
mapping…" then "9 on your map ✓" and the map refreshes); **not these** marks
them `DECLINED` — the rows stay, so the finds are never offered again. ✕ is
"not now": the pill stays quiet for the session and returns next launch. The
Connections screen shows the same ask inline per account ("9 waiting for a
yes · add them · not these") for the moment right after linking.

Endpoints: `GET /api/me/connections/pending` (total, per-account groups with
three titles, an `adding` flag while a background add runs) and
`POST /api/me/connections/pending { action: "add" | "decline", provider? }`.
A find that fails to capture during "add" is declined rather than re-asked.

## The picker

The screen opens with a strip of service marks drifting sideways on a loop
(`ProviderMarquee`). Tap one or more to open their cards below; tap again to
put one away. Connected services wear a dot and always show. Marks are drawn,
not loaded — an initial in each service's colour, plus Letterboxd's three
dots and YouTube's play tile — so there are no logo assets to license. Each
card carries a one-line "what comes over" and a two-sentence hint that states
the quirk honestly (the 50-entry Letterboxd window, the public-shelf rule,
that Raindrop notes stay in Raindrop).

## Operational notes

- Schema is additive (new tables, one nullable column): push to prod
  **before** deploying code (see `docs/deployment.md`).
- `render.yaml` gains a cron service; like `mneme-notifications` it is a
  blueprint change and needs an explicit sync in the Render dashboard.
- One optional env var: `TRAKT_CLIENT_ID` (register a free app at
  trakt.tv/oauth/applications/new). Without it Trakt says "isn't switched on
  for mneme yet" rather than failing mysteriously.
- `ensureUserPreference` became an upsert: two concurrent first captures for
  a brand-new user raced on the row.
