# Landing screen: the muses intro

**Date:** 2026-08-07
**Surface:** `mobile/app/index.tsx` (the signed-out opening screen)

## Problem

The signed-out landing screen is too simple. It shows the braille `Brain`, a
typed tagline, a headline and two CTAs — all correct, none of it memorable. The
site carries a line the app does not:

> Before the nine muses there were three: *Melete* for practice, *Aoide* for song,
> and *Mneme* for memory. This one is for Mneme.

That line has an animation built into it that nothing else on the screen does —
**nine becomes three becomes one** — and it explains the product's name, which
the current screen never does.

A first pass staged that line as three fading blocks of text over a drifting
haze. It was not enough: three lines appearing is not an idea, it is a
transition. The background has to *mean* the sentence.

## Goal

Turn the landing into an arrival that says the muses line and resolves into the
existing screen. **Nine connected points collapse to three, become the three
names, and the surviving one travels into the corner to become the wordmark.**

## Governing constraints

These override any other choice in this document:

1. **Theme-consistent.** No new colours, no new fonts, no new dependencies.
   Every value comes from `constants/theme.ts` via `useThemeColors()`. The
   screen keeps following light/dark rather than going always-dark.
2. **Minimal.** Three new components, one modified screen. No configuration, no
   props that only have one caller, no abstraction that serves a single use.
3. **Smooth.** Every motion is eased and slow. Nothing linear, nothing snappy,
   nothing that draws attention to the fact that it is an animation.

## Non-goals

- A video background. It would mean `expo-video` as a new native dependency, a
  bundled asset, and a soft photographic look that would be the only thing in
  the app not drawn from type. Rejected.
- Replacing or shrinking the `Brain`. It stays exactly as it is.
- Changing the headline, tagline, or CTA copy.
- Adding the haze to sign-in / sign-up. Out of scope for this change.

---

## Beat sheet

| t | Beat |
|---|---|
| 0.0s | Haze and the nine-point constellation fade up |
| 0.35s | *Before the nine muses* arrives **a word at a time** |
| 1.25s | *there were three.* arrives, word at a time |
| 2.15s | **The collapse.** Six points and all the edges dissolve; the three survivors glide down out of the sky |
| 3.1s | The three names fade in beneath their points, staggered |
| 4.05s | The opening dims to 30% behind the closing line |
| 4.1s | *This one is for mneme.* arrives, word at a time, at the same size as the opening |
| 5.7s | Melete and Aoide rise away and fade, taking their points |
| 5.9s | Both statements clear, so the screen is empty but for one word |
| 6.5s | **The morph.** Mneme travels into the wordmark slot over 1150ms |
| 7.4s | The brain, tagline, headline and CTAs run the existing stagger |
| 7.65s | The word lands; the intro retires |

Tap anywhere to skip. All timings are named constants at the top of
`MusesIntro.tsx`, so the pacing is tunable in one place.

Ordering matters here and was got wrong first time: overlapping the departure of
Melete and Aoide with Mneme's travel read as *Mneme escaping* rather than as the
other two dissolving. They now leave first, and the statements clear next, so
the last word crosses an empty screen.

---

## Components

### `mobile/components/landing/HazeField.tsx` (new)

The ambient layer, behind everything, for the whole life of the screen.

15 marks in 3 parallax layers of 5. Positions are a hardcoded table of
percentages — deterministic, so the field renders identically every launch and
cannot clump. Glyphs are single-dot braille (`⠂ ⠄ ⠁ ⠈ ⠐`), the same alphabet the
`Brain` is drawn in.

**Only 6 animated values, not 30** — each *layer* animates as one unit
(translate plus a slow opacity breathe), not each mark. Reanimated shared values
on the UI thread, matching `components/ui/Skeleton.tsx`. The two periods within
a layer are deliberately unequal, so marks trace a slow Lissajous path rather
than a straight diagonal, and the three layers never resync.

| Layer | Glyph size | Alpha | Amplitude | Period |
|---|---|---|---|---|
| near | 16–20px | 0.16 | 22px | 17s |
| mid | 12–14px | 0.10 | 16px | 23s |
| far | 8–10px | 0.06 | 10px | 29s |

**Props.** `opacity` (the multiplier the screen drives, which doubles as the
fade-in) and `reduceMotion`, passed down rather than read again so the
preference is queried once, by the screen.

### `mobile/components/landing/Constellation.tsx` (new)

Nine points across the upper third, joined by faint lines — deliberately the
same visual language as Atlas, so the intro looks like the product rather than
like a particle effect.

Coordinates are fractions of the field and fixed, not random: the constellation
has to be the same shape every launch, and a random nine eventually produces a
bad one. Two things were tuned by looking at it on device:

- **Every edge joins near neighbours.** Long edges cut across the field and turn
  the whole thing into a scribbled polygon. The final set is short-span and
  branching, with one spur, which is what reads as a constellation.
- **Dots must outweigh lines.** First pass had 15px marks against 0.13-opacity
  strokes and the lines dominated. Final: 20px marks at 0.5, strokes at 0.09 and
  0.6px wide.

This component draws the **six that do not survive**, plus the edges between all
nine. The three survivors are drawn by the intro, inside the names row, so only
their coordinates are exported.

### `mobile/components/landing/MusesIntro.tsx` (new)

The sequence, the collapse, and the morph.

**One clock, three eased drivers.** Opacity beats interpolate off a single
`Animated.Value` counting milliseconds, so the pacing is legible in one place.
The three motions that carry the piece — `collapse`, `part`, `morph` — get their
own `Animated.timing` with a real easing curve (`Easing.bezier(0.16, 1, 0.3, 1)`),
because sampling a curve off a linear clock leaves visible kinks in the
velocity. That was the actual cause of the first version's morph feeling
unsmooth; doubling its duration alone would not have fixed it.

**The morph is a pure translation.** All three names are set in
`variant="wordmark"` at its natural size, so the word that travels already *is*
the wordmark — no scale, no cross-fade, no font seam.

**Everything lands on measured boxes.** The intro root, the names row, each name
column, each survivor's dot, and Mneme's word all report an `onLayout` box, and
the screen passes down the wordmark's own measured box. Every box resolves
against the same parent, so they subtract cleanly — no assumption about how Yoga
insets absolutely-positioned children by padding, which is the kind of thing
that silently differs by platform. The timeline does not start until they are
all in.

**Word-at-a-time reveals.** Each line is a flex-wrapped row of `Animated.Text`,
one per word, staggered 105ms with a fade and a small rise. Invisible words
still occupy their layout, so nothing reflows as a line fills in.

**Typography.** Both statements are set at `FontSize['2xl']`; only colour
separates them. The first pass set the closing line at `serif`/16px muted
against `h2`/26px, and the size drop read as a different element rather than as
a coda.

**Copy.** The names are lowercase and unpunctuated so the surviving one matches
the wordmark exactly:

1. `Before the nine muses` / `there were three.`
2. `melete` `aoide` `mneme`
3. `This one is for mneme.`

**Departures.** Melete and Aoide rise 16px as they fade, back towards the
constellation they came down from. Drifting them sideways instead put Aoide
straight through Mneme, which is the one word that must stay legible.

**Skip.** A full-screen `Pressable`. On press it clears the pending timers,
stops all four drivers, and cross-fades the intro out over 260ms — the word does
not fly on a skip, because someone who tapped wants the screen, not the
flourish.

### `mobile/app/index.tsx` (modified)

- Wraps the screen in a plain `View` so `<HazeField>` sits behind the
  `SafeAreaView` and fills the whole display rather than being inset by it.
- **Resolves auth before starting anything.** See below.
- Holds `contentIn` (start the entrance stagger, fired by `onHandoff`) and
  `introDone` (retire the intro, reveal the wordmark, fired by `onDone`). Two
  signals rather than one, because for 250ms the travelling word and the real
  wordmark would otherwise both be on screen a few pixels apart.
- Measures the wordmark's own layout box and passes it to the intro as the target.
- `TypedTagline` gains `start` and `text` props.
- Everything else — the `Brain`, the breath and sway loops, the headline, both
  CTAs, all styles and copy — is untouched.

---

## Returning users

**The bug.** A signed-in user saw the first line of the intro for about two
seconds and was then yanked into the app. The screen gated on `isLoading`, which
stays true until the `/api/me` round-trip finishes.

**The fix.** `getToken()` resolves in milliseconds, and `AuthContext` flips
`isAuthenticated` at `AuthContext.tsx:133` *before* the profile fetch. So within
a frame the screen knows which of three states it is in:

| State | Condition | What renders |
|---|---|---|
| Unknown | `isLoading && !isAuthenticated` | Haze only. Lasts one or two frames — a keychain read. |
| Returning | `isAuthenticated && isLoading` | The braille brain, breathing, and `> welcome back` typed beneath it. No intro. |
| Signed out | `!isAuthenticated && !isLoading` | The intro runs. |

The returning state reuses the brain block that the landing already renders —
it is mounted in both states rather than swapped, so a returning user whose
profile fetch fails does not watch the brain remount underneath them. It is also
the most pertinent thing available: it is literally their brain waking up.

---

## Accessibility

`AccessibilityInfo.isReduceMotionEnabled()` is read once on mount. When enabled
the intro does not run, the screen renders immediately, and `HazeField` renders
static. A seven-second full-screen motion piece is precisely what that setting
exists for, and the app does not currently honour it anywhere else.

---

## Edge cases

| Case | Behaviour |
|---|---|
| Back-navigation from sign-in | Does not replay. Expo Router keeps the screen mounted in the stack. |
| Authenticated with a profile | Never mounts the intro — the existing `<Redirect>` returns first. |
| Tap during any beat | Cross-fades to the landing in 260ms. |
| Reduce Motion | Intro skipped, haze static. |

---

## Verification

There is no mobile test harness in this repo — vitest covers `src/server` and
`tests/integration` only, and adding one for a purely visual component is not
justified by this change. Verification is manual, on the iOS simulator:

```
cd mobile && EXPO_NO_DOCKER=1 npx expo start --ios -c
```

Verified on an iPhone 17 Pro simulator by capturing the sequence frame by frame:

- [x] Light mode: haze as a faint warm speckle on paper, constellation legible
- [x] Dark mode: reads as an actual night sky
- [x] Word-at-a-time reveals, with no reflow as a line fills
- [x] The collapse — six points and the edges dissolve, three glide down and
      land centred above their names
- [x] Both statements at one size, separated only by colour
- [x] Melete and Aoide clear before the morph, with no collision into Mneme
- [x] Mneme crosses an empty screen and lands on the wordmark slot
- [x] Handoff — brain, tagline, headline and CTAs rise; settled screen unchanged
- [x] Returning state — brain plus `> welcome back`, no intro (checked by
      temporarily forcing the branch, then reverting)

Not verified by automation — the simulator has no tap injection, so these were
checked by reading the code rather than by driving the UI:

- [ ] Tap-to-skip during each beat
- [ ] Navigating to sign-in and back does not replay the intro
- [ ] A real returning user's ~2s profile fetch (the branch was forced, not
      driven by an actual token)
