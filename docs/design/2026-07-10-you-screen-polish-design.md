# You Screen Polish — Design

Date: 2026-07-10
Scope: mobile "You" tab. All work in `mobile/components/wrapped/WrappedSection.tsx`,
`mobile/components/wrapped/copy.ts`, and `mobile/app/(tabs)/profile.tsx`.

## Goals

Make the wrapped sections on the You screen less text-heavy, less redundant, and
nicer to look at, per direct user feedback. Six discrete changes.

## 1. Topics card → bouncing bubble physics

**Problem:** The `TopicMass` card names the top topic in a sentence overline
(`TOPIC_TITLES`, e.g. "X, again. And again.") and then renders the same topic as
the largest word in the mass — the topic is stated twice. The whole card is just
sized text, no real graphic.

**Change:**
- Replace `TopicMass` with a contained physics playground `TopicBubbles`.
- Each top topic is a squishy bubble; radius driven by frequency **and** by the
  space its label needs (long names like "applications of AI in biology" wrap to
  2 lines, font scales down to fit). Top topic is largest and in the accent color.
- Bubbles drift, collide with each other and the container walls, and briefly
  squish (scale deform) on impact.
- The animation loop only runs while the card is on-screen AND the tab is focused;
  it pauses otherwise to avoid draining battery.
- Overline becomes a short neutral kicker that does NOT name the top topic
  (e.g. "on your mind"). Remove the redundant `topicsTitle` sentence usage.

**Isolation:** `TopicBubbles` is a self-contained component. Inputs: `items`
(`{name, count}[]`), `accent`, `active` (on-screen + focused). No external state.

## 2. "New this month" → horizontal discovery timeline

**Problem:** `DiscoveryRail` is a vertical dotted list — reads like bullets.

**Change:** Horizontal timeline — one line running left→right in discovery order,
a node per topic, labels along it. Same data (`newTopicsThisMonth`), new layout.

## 3. Clock (rhythm card), simplified

**Problems:** center "3pm / your hour" text is crammed and repeats info; the
`12a/6a/12p/6p` tick labels float at the container edges; a "longer spoke = more
saved" caption over-explains.

**Change:**
- Remove the dial-center text entirely; center stays clean.
- State the peak time once in the card header.
- Move the four tick labels in tight against the dial ring.
- Drop the caption.

## 4. Weekday bars → moved to the Timeline card

The weekday histogram currently lives in the rhythm card. Move it into the
`Timeline` card (the existing home for activity-over-time histograms), leaving the
clock as a single clean dial. The rhythm-card header copy focuses on the hour only.

## 5. Day streak, de-duplicated

**Problem:** When current streak == longest, the big number, the longest-streak
line, and the "N days and counting" line all restate the same count.

**Change:**
- current == longest: show one framing (the live "N days and counting"); drop the
  separate longest line.
- current < longest: record is the headline; current run is a quiet secondary note.
- current == 0: show the record only.
- Never two lines stating the same number.

## 6. Scroll-to-top on focus (`profile.tsx`)

Add a ref to the `Animated.ScrollView`; on `useFocusEffect`, reset scroll to y=0 so
the user always lands at the hero.

## Risks

The bubble physics is the only real complexity — a hand-rolled loop with circle
collision and squish. Everything else is layout/copy edits. Keep the physics gentle
and cap the topic count so collision cost stays trivial.
