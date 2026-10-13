# Mneme UI conventions

The app reads like a native iOS app. Every screen is held to the rules below.
When an old pattern and this document disagree, this document wins.

## Type

One family: the system face (SF Pro on iOS) through the `Text` variants in
`components/ui/Text.tsx`. Hierarchy comes from size and weight, never from a
second family, tracking, or capitals.

| Use | Variant |
|---|---|
| Screen title in the chrome band | `headline` (17 semibold) |
| Section header on a page | `h4` via `SectionKicker` (20 semibold) |
| Row title, card title | `headline` or `bodySemiBold` |
| Body copy | `body` |
| Secondary line under a title | `subheadline` (15, `color="secondary"`) |
| Dates, counts, hints, status | `caption` (13, `color="muted"` or `"faint"`) |
| Tiny axis ticks | `captionSmall` (12) |
| Numbers that must align | `tabular` |
| Big stat numbers | `hero` / `display` (bold, tabular) |
| The brand mark only | `wordmark` |

`mono`, `monoSmall`, `serif` and `serifLg` are historical names that now
render in the system face (footnote, footnote, body, title 3) so old call
sites fall into line; new code does not use them. The Times serif exists only
in `wordmark` and the share-card artwork. Do not add `letterSpacing`,
`textTransform: 'uppercase'`, `fontStyle: 'italic'`, `.toUpperCase()` or
`.toLowerCase()` to UI text. Do not use `FontFamily.mono` or
`FontFamily.serif` for anything that is not code or the share cards.

Copy the server sends for display (Today's "why now" line, push bodies,
insight kickers) follows the same rules; the client sentence-cases a model
kicker before printing it.

## Copy

- Sentence case everywhere: "See all", "Edit profile", "Search your saves".
  Screen titles and tab titles are capitalised: "Mind", "Archive", "You".
- No decorative glyphs in text. No trailing arrows (`→`, `↓`, `↗`), no em or
  en dashes (`—`, `–`), no middle dots (`·`) as separators, no `…` loading
  poetry, no `✕`/`ⓘ` characters standing in for icons. Separate meta with a
  comma, a space, or a second line. Use a lucide icon where an icon is meant.
- Say what the thing is. "Topics you haven't added to in a while" beats
  "gone quiet, worth reawakening?". A heading names its content; a hint tells
  the user what will happen. No aphorisms, no second-person flattery, no
  rhetorical questions.
- One register. No "whispers", "kickers" or "eyebrows" above headings.
- Loading: a single plain line ("Loading your diary") or none. Empty states
  go through `ScreenIntro` with a title, one or two sentences, and real
  buttons.
- Buttons are verbs with their object: "Open in Atlas", "Continue in
  companion", "Load earlier". Never "see everything ↓".

## Dates

Use `lib/dates.ts`. Group headers use `dayLabel` ("Today", "Yesterday",
"Monday", "October 2"). Trailing dates on rows use `shortDate` ("Oct 2").
Set in `caption`, sentence case, never uppercased.

## Controls

- Search: `components/ui/SearchField` (magnifying glass, "Search" placeholder,
  clear button). Never a text prefix like `FIND_`.
- Switching views of the same content: `components/ui/SegmentedControl`.
- Sorting or secondary choices: `ActionSheetIOS` on iOS, a small menu
  elsewhere. Never a row of lowercase pills.
- Navigation rows end in a `ChevronRightIcon`, not an arrow in the label.
- Info: `InfoModal` has a grabber, a sentence-case title, and a Done button.
- Dismissal: a Done or Close button, a chevron, or a swipe. Never "tap to
  close" text.
- Chips and pills: `Badge`, sentence case.

## Decoration

Colour carries meaning or it is not there. A dot beside a topic name is that
topic's colour and stays. Ticks beside headings, decorative dots in the corner
of a card, breathing marks, status dots with no state, and section numbering
are gone. Cards are one level deep. Hairlines are `StyleSheet.hairlineWidth`.
