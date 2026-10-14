# Mneme UI conventions

The app reads like a native iOS app. Every screen is held to the rules below.
When an old pattern and this document disagree, this document wins.

## Type

One family: the system face (SF Pro on iOS) through the `Text` variants in
`components/ui/Text.tsx`. Hierarchy comes from size and weight, never from a
second family, tracking, or capitals.

| Use | Variant |
|---|---|
| Tab title in the chrome band | `pageTitle` (28 bold) |
| Pushed screen title, centred | `headline` (17 semibold) |
| Section header on a page | `h4` via `SectionKicker` (20 semibold) |
| Row title, card title | `headline` or `bodySemiBold` |
| Body copy | `body` |
| Secondary line under a title | `subheadline` (15, `color="secondary"`) |
| Dates, counts, hints, status | `caption` (13, `color="muted"` or `"faint"`) |
| Tiny axis ticks | `captionSmall` (12) |
| Numbers that must align | `tabular` |
| Big stat numbers | `hero` / `display` (bold, tabular) |
| The brand mark only | `wordmark` |

The tab bar shows icons only; each tab's name reaches VoiceOver through its
accessibility label. A list of destinations (Mind's overview) is an inset
grouped list: a rounded surface, hairline separators, a title and one-line
description per row, a trailing value, a chevron. The mark at the left of a
row is never a stock icon on a coloured tile; it is a 36pt miniature of the
screen the row opens, drawn in that screen's colour (`SectionMark`).

Decorative SVG inside a scrolling list carries `pointerEvents="none"`, or
it swallows the drag and the list will not scroll from that spot. Close
and back controls are 44pt targets on a header with `zIndex` above the body.

The capture sheet offers Link, Note, Image and Title on one row; Title
reveals the work kinds beneath it. The input box keeps one height across
kinds and carries no label of its own, only a placeholder.

A list of insights shows the first one open and the rest as their category
and line (two lines at most); a tap opens one. The note is `subheadline`
under a `bodyMedium` line, never a run of bold paragraphs.

A number, its stamp and a sentence about it are one fact, not three. A card
states each fact once: the You page hero shows the count and the milestone
stamp; the rhythm card shows one sentence with the hour and the dial; the
format card is one sentence with the share.

`mono`, `monoSmall`, `serif` and `serifLg` are historical names that now
render in the system face (footnote, footnote, body, title 3) so old call
sites fall into line; new code does not use them. The Times serif exists only
in `wordmark` and the share-card artwork. Do not add `letterSpacing`,
`textTransform: 'uppercase'`, `fontStyle: 'italic'`, `.toUpperCase()` or
`.toLowerCase()` to UI text. Do not use `FontFamily.mono` or
`FontFamily.serif` for anything that is not code or the share cards.

Copy the server sends for display follows the same rules. Every user-facing
prompt in `src/server/cognition/llm.ts` carries `STYLE_RULES` (sentence case,
no dashes, no rhetorical openers). Anything the model wrote that reaches a
screen goes through `lib/text.ts` on the way in: `plainProse` for sentences,
`plainLabel` for a heading, `sentenceCase` for a topic name used as a title.
That is what keeps cached, older generations in line with new ones.

## Labels above content

A small muted caption sitting above a bold line ("Reinforces" over an
insight, "Mneme" over a message, "You staked this on X" over a quote) is the
eyebrow pattern and is gone. Three replacements, by what the label was doing:

- It named a category: a category row, a 14pt lucide glyph and the name in
  `subheadline` semibold, secondary colour, then the content (`InsightLine`).
- It explained the line under it: it moves below the title as a
  `subheadline` in the secondary colour (Today's "Your position on X").
- It named the speaker or the section: it goes; the layout already says it
  (companion replies are plain text, user messages are bubbles).

A note's lead ("The catch", "What it adds") runs into the note in bold,
"The catch. If that were true...", never on its own line above it.

## Layout

A screen is a list or a stack of cards on the canvas, one level deep. No
progress strips or step labels on sheets, no blockquote bars down the side of
a paragraph, no meters or strength bars beside a line of text, no accent dot
in a card corner. Primary actions are full-width buttons; secondary actions
are rows with a chevron or small secondary buttons in a wrapping row.

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
- Loading keeps its character: the landing line types itself out with a
  blinking cursor, and every loader caption ends in an ellipsis and may
  rotate through short lines ("Drawing your map…", "Plotting your ideas…").
  Sentence case, system face. Empty states go through `ScreenIntro` with a
  title, one or two sentences, and real buttons.
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
