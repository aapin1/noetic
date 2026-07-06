# Onboarding tutorial design

## Purpose

New users land in mneme with a fully-formed 6-tab app and no walkthrough beyond the profile-setup steps (`(onboarding)/topics` → `identity` → `starter-links` → `preview`), which configure the user's profile but never explain the UI itself. Two genuinely useful features are also invisible unless you already know they exist: sharing content into mneme from the OS share sheet, and the fact that mneme tries to read the full source of anything you save and falls back to asking what it was about if it can't.

This adds an interactive, skippable walkthrough that moves the user across the real tabs, auto-shown once right after account creation, and always reachable afterward from a new button next to Atlas's info button.

## Trigger points

1. **After sign-up.** `(onboarding)/preview.tsx`'s "Start" action still calls `refreshProfile()` and `router.replace('/(tabs)')`, then calls `startTutorial()`. Since the tab landing screen is already Atlas, no extra navigation is needed for the first step.
2. **Sign-in.** Never auto-starts, regardless of device or whether the tutorial was previously completed. No "has seen tutorial" flag is stored anywhere.
3. **Manual replay.** A new button on the Atlas tab, styled identically to the existing `ⓘ` info button, calls `startTutorial()` directly. It lives only on Atlas, immediately to the right of the info button.

There is no persistence of tutorial progress or completion. If the app is backgrounded or killed mid-tutorial, it simply doesn't resume; the user can restart it from the Atlas button.

## Components

**`mobile/contexts/TutorialContext.tsx`** — a provider mounted at the root layout (sibling to `AuthProvider`, above the `(auth)`/`(onboarding)`/`(tabs)` stacks so both `preview.tsx` and the Atlas button can reach it). Exposes:

```ts
{
  active: boolean;
  stepIndex: number;
  step: TutorialStep;          // steps[stepIndex]
  start(): void;                 // active=true, stepIndex=0
  next(): void;                  // stepIndex++, or stop() if on last step
  back(): void;                  // stepIndex--, no-op on first step
  stop(): void;                  // active=false (used by both Skip and the final Done)
}
```

A `useEffect` keyed on `stepIndex`/`active` calls `router.push(step.tab)` whenever the target tab differs from the current one, so both `next()` and `back()` navigate correctly.

**`mobile/constants/tutorialSteps.ts`** — ordered array of step data (see Content below): `{ id, tab, title, body }`. `tab` is one of the six tab routes; every step (including welcome/done) targets `atlas`, since the tutorial can only be started from there.

**`mobile/components/ui/TutorialOverlay.tsx`** — mounted once near the root (in `app/_layout.tsx`, alongside where `AuthProvider`/theming already wrap the stack). Reads `useTutorial()`; renders nothing when `!active`. When active, renders a core RN `<Modal transparent animationType="fade" visible>` (matching `InfoModal`'s primitive, not Reanimated) containing:

- A full-screen `rgba(0,0,0,0.45)` scrim (same tone as `InfoModal`). Unlike `InfoModal`, it is **not** tap-to-dismiss — accidental taps shouldn't cancel the tutorial. RN's `Modal` already blocks touches from reaching the real screen underneath, satisfying "scrim blocks interaction."
- A bottom-anchored card reusing `InfoModal`'s exact visual language: `c.surface` background, `c.border` border, `Radius.lg`, `Spacing[6]` padding, mono-uppercase title (`variant="monoSmall"`, `letterSpacing: 2`), serif body (`variant="serif"`, `color="secondary"`, `lineHeight: 26`).
- A step-dot row above the controls, reusing the capture sheet's dot convention (filled dot for current step, hollow for others).
- A control row: "skip tutorial" as a plain text `Pressable` (mono, `c.faint`, lower-left, echoing `InfoModal`'s "tap to close" footer style) on the left; `Back`/`Next` as the existing `<Button>` component on the right, so press feedback (opacity fade + haptic) comes for free. `Back` is hidden on step 0. `Next` reads "next" on every step except the last, where it reads "start exploring" and calls `stop()` instead of `next()`.

## Content (steps, in order)

Voice matches existing InfoModal/empty-state copy: lowercase titles, short declarative serif body sentences, no promotional language.

1. **welcome** (tab: atlas)
   "A quick walk through what mneme does, including a couple of things it does quietly in the background. Takes about a minute. Skip whenever you want."

2. **atlas** (tab: atlas)
   "This is home. Every node here is something you saved, and lines form when ideas share a topic, contradict each other, or grow out of one another. Try the lenses at the top to sort the map by meaning, time, or source."

3. **capture** (tab: atlas)
   "Tap the plus to save something: a link, a thought, a quote, or a photo. On the next screen you can add a quick reaction, one line just for you, or leave it blank."

4. **share to mneme** (tab: atlas)
   "You don't have to open the app to save something. From Safari, Reddit, YouTube, wherever, use the share button and look for mneme in the list. It drops straight into the same capture flow."

5. **reading the source** (tab: atlas)
   "When you save a link, mneme tries to read the whole thing: the article, the transcript, the caption. If it can't get enough, it'll ask what the piece was about, in your own words. That's what the map and the insights get built from."

6. **archive** (tab: memory)
   "A chronological record of everything you've saved. Each entry shows its type, when it was captured, and the key idea mneme pulled from it."

7. **pulse** (tab: pulse)
   "Follow people by their handle. A small version of their map, plus their latest logs, shows up here. Search is always open at the top if you want to find someone."

8. **drift** (tab: trends)
   "Tracks how your attention moves across topics over time. Closer to the centre of the galaxy means more recent. Tensions show up when something new pulls against what you already hold."

9. **mind** (tab: mind)
   "What's already sitting in your map: patterns you missed, ideas that contradict each other, threads that keep coming back. All of it comes from what you saved, not from prompts."

10. **you** (tab: profile)
    "Your profile: handle, identity, how many things you've saved. Settings and sign out live here too."

11. **you're set** (tab: profile)
    "That's the whole map. Go save something."

Step 11 stays on the profile tab, where step 10 already landed; there's no reason to navigate back to Atlas just to say goodbye.

## Atlas tutorial button

In `mobile/app/(tabs)/index.tsx`, next to the existing info `Pressable` (lines ~2282-2294), add a second `Pressable` using the same glyph-as-text convention rather than a lucide icon, to stay consistent with how the info button is built:

```tsx
<Pressable
  onPress={() => startTutorial()}
  hitSlop={12}
  accessibilityLabel="Start tutorial"
  style={{ marginLeft: Spacing[3] }}
>
  <Text style={{ color: 'rgba(236,236,236,0.35)', fontSize: 16 }}>ⓣ</Text>
</Pressable>
```

`ⓣ` (U+24E3, circled small t) mirrors `ⓘ` (U+24D8) exactly: same font, size, color, hit slop, and spacing, just a different letter. Placed to the right of the info button in the same `headerTitleRow`.

## Edge cases

- **Starting the tutorial from a non-Atlas tab:** can't happen, since the only manual entry point lives on Atlas.
- **Rapid taps on Next/Back:** step index is clamped; `next()` on the last step calls `stop()` instead of overrunning the array.
- **Navigating away manually mid-tutorial:** not possible while `active`, since the Modal blocks touches to the tab bar and underlying screens.
- **App backgrounded mid-tutorial:** state is in-memory only (React context, not persisted); resuming the app mid-tutorial keeps it active since the JS context survives backgrounding, but a full kill-and-relaunch resets `active` to false. Acceptable since there's no completion tracking either way.

## Testing

- Unit test `TutorialContext` reducer-like logic: `start` resets to step 0, `next`/`back` clamp correctly, `next` on the last step calls `stop`.
- Manual verification (per CLAUDE.md, this is a UI change): run the mobile app, sign up a fresh account, confirm the tutorial auto-starts on Atlas after `preview.tsx`'s Start button; step through Next/Back across all six tabs; confirm Skip stops it at an arbitrary step; sign out, sign back in, confirm it does *not* auto-start; tap the new `ⓣ` button on Atlas and confirm it restarts from step 1.
