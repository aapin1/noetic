# Landing screen: the muses intro

**Date:** 2026-08-07
**Surface:** `mobile/app/index.tsx` (the signed-out opening screen)

## Problem

The signed-out landing screen is too simple. It shows the braille `Brain`, a typed
tagline, a headline and two CTAs — all correct, none of it memorable. The site
carries a line the app does not:

> Before the nine muses there were three: *Melete* for practice, *Aoide* for song,
> and *Mneme* for memory. This one is for Mneme.

That line has an animation built into it that nothing else on the screen does —
**nine becomes three becomes one** — and it explains the product's name, which
the current screen never does.

## Goal

Turn the landing into a short two-beat arrival that says the muses line and then
resolves into the existing screen, with a slow drifting field behind it for
atmosphere. The word **Mneme** is the hinge: it is in the sentence on beat one,
and it is the wordmark on beat two.

## Governing constraints

These override any other choice in this document:

1. **Theme-consistent.** No new colours, no new fonts, no new dependencies. Every
   value comes from `constants/theme.ts` via `useThemeColors()`. The screen keeps
   following light/dark rather than going always-dark.
2. **Minimal.** Two new components, one modified screen. No configuration, no
   props that only have one caller, no abstraction that serves a single use.
3. **Smooth.** Every motion is eased and slow. Nothing linear, nothing snappy,
   nothing that draws attention to the fact that it is an animation.

## Non-goals

- A video background. It would mean `expo-video` as a new native dependency, a
  bundled asset, and a soft photographic look that would be the only thing in the
  app not drawn from type. Rejected.
- Replacing or shrinking the `Brain`. It stays exactly as it is.
- Changing the headline, tagline, or CTA copy.
- Adding the haze to sign-in / sign-up. Out of scope for this change.

---

## Beat sheet

| t | What happens | Duration | Easing |
|---|---|---|---|
| 0.0s | Haze fades up from 0 | 900ms | `out(quad)` |
| 0.3s | *Before the nine muses* / *there were three.* fades and rises in | 600ms | `out(cubic)` |
| 1.5s | *Melete.  Aoide.  Mneme.* fades in beneath it | 600ms | `out(cubic)` |
| 2.7s | Opening lines dim to 30%; *This one is for Mneme.* fades in | 600ms | `inOut(quad)` / `out(cubic)` |
| 4.0s | **Morph.** Melete and Aoide fade out drifting apart; remaining lines fade; Mneme scales down and travels to the wordmark slot | 600ms | `out(cubic)` |
| 4.4s | Brain, tagline, headline and CTAs run the existing 160ms stagger | 620ms each | unchanged |

The slide-two stagger begins **200ms before the morph lands**, deliberately
overlapping it, so the two beats read as one continuous motion rather than as a
scene change. CTA is tappable at roughly 4.6s; the whole intro is skippable.

When the intro retires (4.6s, or immediately on skip) the haze eases to 60% of
its intro opacity so it never competes with the CTA, and keeps drifting
indefinitely. The settle reuses the same 900ms fade constant as the entrance —
one number rather than two that nobody could tell apart.

All timings live as named constants at the top of `MusesIntro.tsx` so the pacing
is tunable in one place.

---

## Components

### `mobile/components/landing/HazeField.tsx` (new)

A drifting background layer. Renders behind everything on the landing screen.

**Marks.** 15 marks in 3 parallax layers of 5. Positions are a hardcoded table of
percentages — deterministic, so the field renders identically every launch and
cannot accidentally clump. Glyphs are single-dot braille (`⠂ ⠄ ⠁ ⠈ ⠐`), the same
alphabet the `Brain` is drawn in, at 8–20px. Each mark sits at 6–16% alpha on
`c.text`, which is a faint warm speckle on paper and a faint glow on ink — one
implementation, both themes.

**Motion.** Each *layer* animates as a unit, not each mark: 6 animated values
total, not 30. Per layer, a translate loop and a slow opacity breathe, both
`withRepeat(withSequence(withTiming(...)))` on Reanimated shared values, matching
the existing pattern in `components/ui/Skeleton.tsx`. Easing is `inOut(sin)`
throughout so drift never has a visible turnaround.

Parallax gives the depth: the layer with the largest and most opaque glyphs
drifts furthest, the faintest drifts least.

| Layer | Glyph size | Alpha | Amplitude | Period |
|---|---|---|---|---|
| near | 16–20px | 0.16 | 22px | 17s |
| mid | 12–14px | 0.10 | 16px | 23s |
| far | 8–10px | 0.06 | 10px | 29s |

Periods are coprime-ish so the layers never visibly resync.

**Props.** `opacity: number` — the multiplier the landing screen drives to fade
the field in and later settle it to 60% — and `reduceMotion: boolean`, passed
down rather than read again so the preference is queried once, by the screen.

**Static mode.** When Reduce Motion is on, the marks render at their final
positions and opacity with no loops started.

### `mobile/components/landing/MusesIntro.tsx` (new)

Beat one and the morph. Calls `onHandoff()` when the screen behind should start
rising, and `onDone()` once the word has landed and the intro can be retired.

**The morph is a pure translation.** All three names are set in `variant="wordmark"`
at its natural size, which means the word that travels already *is* the wordmark —
no scale, no cross-fade, no font seam, and nothing for a rounding error to land
on. It moves by the delta between where it was laid out and where the real
wordmark sits.

Both are measured rather than assumed: the intro root, the names row, and the
word each report an `onLayout` box, and the screen passes down the wordmark's own
measured box. Every box resolves against the same parent, so they subtract
cleanly — no assumption about how Yoga insets absolutely-positioned children by
padding, which is the kind of thing that silently differs by platform. The
timeline does not start until all four boxes are in.

Melete and Aoide fade to 0 while drifting ~14px outward, so the three names
visibly become one.

**One clock.** The whole sequence interpolates off a single `Animated.Value`
counting milliseconds, driven linearly with `useNativeDriver`. Every beat is a
range on that one clock, so the pacing is legible in one place and the timeline
cannot drift out of sync with itself. Easing that matters — the word's travel —
is baked in as sampled ease-out-cubic points on the interpolation.

**Copy.** Verbatim, across three staged reveals. The names are set lowercase and
unpunctuated so the surviving one matches the wordmark exactly:

1. `Before the nine muses` / `there were three.`
2. `melete` `aoide` `mneme`
3. `This one is for mneme.`

**Skip.** A full-screen `Pressable` covers the intro. On press it clears the
pending stage timers, stops the clock, and cross-fades the whole intro out over
220ms — the word does not fly on a skip, because someone who tapped wants the
screen, not the flourish. `onHandoff()` fires immediately and `onDone()` when the
fade completes.

### `mobile/app/index.tsx` (modified)

- Wraps the screen in a plain `View` so `<HazeField>` can sit behind the
  `SafeAreaView` and fill the whole display rather than being inset by it.
- Holds `contentIn` (start the entrance stagger, fired by `onHandoff`) and
  `introDone` (retire the intro, reveal the wordmark, fired by `onDone`). Two
  signals rather than one, because for 200ms the travelling word and the real
  wordmark would otherwise both be on screen a few pixels apart.
- Measures the wordmark's own layout box and passes it to the intro as the target.
- `TypedTagline` gains a `start` prop so it types on the handoff instead of on
  mount — otherwise it would have finished typing behind the intro.
- Everything else — the `Brain`, the breath and sway loops, the headline, both
  CTAs, all styles and copy — is untouched.

The two `<Redirect>` checks for authenticated users stay at the top of the
component and return before any of this mounts, so a signed-in user never sees a
frame of the intro.

---

## Accessibility

`AccessibilityInfo.isReduceMotionEnabled()` is read once on mount. When enabled:

- The intro does not run. The screen renders slide two immediately.
- `HazeField` renders static.

A 4.6-second full-screen motion piece is precisely what that setting exists for,
and the app does not currently honour it anywhere.

The intro's text nodes carry no `accessibilityLabel` beyond their own content;
VoiceOver reads them in order. Because Reduce Motion is commonly on for the same
users, the skipped path is the accessible path and needs no separate handling.

---

## Edge cases

| Case | Behaviour |
|---|---|
| Back-navigation from sign-in | Does not replay. Expo Router keeps the screen mounted in the stack. |
| Authenticated user | Never mounts — the existing `<Redirect>` returns first. |
| Auth still loading | Unchanged from today: the intro runs while `isLoading` is true, and the redirect fires when it resolves. |
| Tap during any stage | Collapses to slide two in 220ms. |
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

- [x] Light mode: haze reads as a faint warm speckle on paper, never as dirt
- [x] Dark mode: haze reads as a faint glow on warm ink, never as noise
- [x] All three beats stage correctly, including the dim behind the closing line
- [x] The morph travels and lands on the wordmark slot with no jump and no
      double wordmark during the handoff
- [x] Reduce Motion on: no intro, static haze, screen usable immediately
- [x] Settled screen is unchanged from before this work

Not verified by automation — the simulator has no tap injection, so these were
checked by reading the code rather than by driving the UI:

- [ ] Tap-to-skip during each of the three stages
- [ ] Navigating to sign-in and back does not replay the intro
