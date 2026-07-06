# Onboarding Tutorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive, skippable onboarding tutorial that walks a new mneme user across all six tabs plus two hidden features (share-to-mneme, source-reading fail-safe), auto-starting once after sign-up and always replayable from a new button on Atlas.

**Architecture:** A `TutorialProvider` (React Context) mounted at the app root holds `active`/`stepIndex` state and drives `router.push` to the tab each step targets. A `TutorialOverlay` component, also mounted once at the root, renders a full-screen RN `Modal` reusing `InfoModal`'s visual language (scrim + bottom card) whenever the tutorial is active, with Next/Back/Skip controls. Step content lives in a plain data file. Two integration points call into the context: `preview.tsx`'s "Start" button (auto-trigger) and a new `ⓣ` button on Atlas (manual replay).

**Tech Stack:** Expo Router (typed routes), React Context, React Native core `Modal` (no Reanimated needed for the overlay itself — matches `InfoModal`'s primitive), existing `Text`/`Button` UI components.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-onboarding-tutorial-design.md` — read it if anything here is ambiguous.
- No tutorial-completion flag is ever persisted. Auto-start happens exactly once, from `preview.tsx`'s Start action. Sign-in never auto-starts.
- The overlay's scrim blocks touches to the real screen underneath (achieved for free by RN `Modal`); it is **not** tap-to-dismiss, unlike `InfoModal`.
- Copy is fixed by the spec verbatim (see Task 1) — lowercase titles, no em dashes, no promotional language.
- The manual-replay button uses the Unicode glyph `ⓣ` (U+24E3), styled identically to the existing `ⓘ` button (`rgba(236,236,236,0.35)`, `fontSize: 16`, `hitSlop: 12`, `marginLeft: Spacing[3]`) — not a lucide icon.
- **No test framework exists in `mobile/`** (confirmed: no jest config, no `*.test.*` files, no test script in `package.json`). Adding one is out of scope for this feature (would be a large, unrelated addition). Verification for each task is TypeScript compilation (`npx tsc --noEmit --project tsconfig.json` from `mobile/`) plus a final manual end-to-end pass (Task 7), instead of automated unit tests.
- **Baseline typecheck state:** running `npx tsc --noEmit --project tsconfig.json` in `mobile/` today reports exactly 2 pre-existing errors, both at `app/(tabs)/index.tsx:635` and `:636` (an unrelated `lucide-react-native` typing mismatch). Every task's typecheck step must report **exactly these same 2 errors and no others** — that's the pass condition, not zero errors.

---

### Task 1: Tutorial step content data

**Files:**
- Create: `mobile/constants/tutorialSteps.ts`

**Interfaces:**
- Produces: `TutorialTab` (union type), `TutorialStep` (interface: `id`, `tab`, `title`, `body`), `TUTORIAL_STEPS` (`TutorialStep[]`, 11 entries) — consumed by Task 2.

- [ ] **Step 1: Write the file**

```ts
export type TutorialTab = 'index' | 'memory' | 'pulse' | 'trends' | 'mind' | 'profile';

export interface TutorialStep {
  id: string;
  tab: TutorialTab;
  title: string;
  body: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    tab: 'index',
    title: 'welcome',
    body: "A quick walk through what mneme does, including a couple of things it does quietly in the background. Takes about a minute. Skip whenever you want.",
  },
  {
    id: 'atlas',
    tab: 'index',
    title: 'atlas',
    body: "This is home. Every node here is something you saved, and lines form when ideas share a topic, contradict each other, or grow out of one another. Try the lenses at the top to sort the map by meaning, time, or source.",
  },
  {
    id: 'capture',
    tab: 'index',
    title: 'capture',
    body: "Tap the plus to save something: a link, a thought, a quote, or a photo. On the next screen you can add a quick reaction, one line just for you, or leave it blank.",
  },
  {
    id: 'share',
    tab: 'index',
    title: 'share to mneme',
    body: "You don't have to open the app to save something. From Safari, Reddit, YouTube, wherever, use the share button and look for mneme in the list. It drops straight into the same capture flow.",
  },
  {
    id: 'reading-source',
    tab: 'index',
    title: 'reading the source',
    body: "When you save a link, mneme tries to read the whole thing: the article, the transcript, the caption. If it can't get enough, it'll ask what the piece was about, in your own words. That's what the map and the insights get built from.",
  },
  {
    id: 'archive',
    tab: 'memory',
    title: 'archive',
    body: "A chronological record of everything you've saved. Each entry shows its type, when it was captured, and the key idea mneme pulled from it.",
  },
  {
    id: 'pulse',
    tab: 'pulse',
    title: 'pulse',
    body: "Follow people by their handle. A small version of their map, plus their latest logs, shows up here. Search is always open at the top if you want to find someone.",
  },
  {
    id: 'drift',
    tab: 'trends',
    title: 'drift',
    body: "Tracks how your attention moves across topics over time. Closer to the centre of the galaxy means more recent. Tensions show up when something new pulls against what you already hold.",
  },
  {
    id: 'mind',
    tab: 'mind',
    title: 'mind',
    body: "What's already sitting in your map: patterns you missed, ideas that contradict each other, threads that keep coming back. All of it comes from what you saved, not from prompts.",
  },
  {
    id: 'you',
    tab: 'profile',
    title: 'you',
    body: "Your profile: handle, identity, how many things you've saved. Settings and sign out live here too.",
  },
  {
    id: 'done',
    tab: 'profile',
    title: "you're set",
    body: "That's the whole map. Go save something.",
  },
];
```

- [ ] **Step 2: Typecheck**

Run (from `mobile/`): `npx tsc --noEmit --project tsconfig.json`
Expected: exactly the 2 baseline errors at `app/(tabs)/index.tsx:635-636`, nothing new.

- [ ] **Step 3: Commit**

```bash
git add mobile/constants/tutorialSteps.ts
git commit -m "feat(mobile): add onboarding tutorial step content"
```

---

### Task 2: TutorialContext provider + hook

**Files:**
- Create: `mobile/contexts/TutorialContext.tsx`

**Interfaces:**
- Consumes: `TUTORIAL_STEPS`, `TutorialTab`, `TutorialStep` from `@/constants/tutorialSteps` (Task 1).
- Produces: `TutorialProvider` (component, wraps children), `useTutorial()` hook returning `{ active: boolean; stepIndex: number; step: TutorialStep; totalSteps: number; start: () => void; next: () => void; back: () => void; stop: () => void }` — consumed by Task 3 (overlay), Task 5 (`preview.tsx`), Task 6 (Atlas button).

- [ ] **Step 1: Write the file**

```tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { TUTORIAL_STEPS, TutorialStep, TutorialTab } from '@/constants/tutorialSteps';

const TAB_ROUTES: Record<TutorialTab, string> = {
  index: '/(tabs)',
  memory: '/(tabs)/memory',
  pulse: '/(tabs)/pulse',
  trends: '/(tabs)/trends',
  mind: '/(tabs)/mind',
  profile: '/(tabs)/profile',
};

interface TutorialContextValue {
  active: boolean;
  stepIndex: number;
  step: TutorialStep;
  totalSteps: number;
  start: () => void;
  next: () => void;
  back: () => void;
  stop: () => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const prevTabRef = useRef<TutorialTab | null>(null);

  const start = useCallback(() => {
    prevTabRef.current = null;
    setStepIndex(0);
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
  }, []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i >= TUTORIAL_STEPS.length - 1) {
        setActive(false);
        return i;
      }
      return i + 1;
    });
  }, []);

  const back = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const step = TUTORIAL_STEPS[stepIndex];

  useEffect(() => {
    if (!active) return;
    if (prevTabRef.current === step.tab) return;
    prevTabRef.current = step.tab;
    router.push(TAB_ROUTES[step.tab] as never);
  }, [active, step, router]);

  const value = useMemo<TutorialContextValue>(
    () => ({ active, stepIndex, step, totalSteps: TUTORIAL_STEPS.length, start, next, back, stop }),
    [active, stepIndex, step, start, next, back, stop],
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error('useTutorial must be used within a TutorialProvider');
  }
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

Run (from `mobile/`): `npx tsc --noEmit --project tsconfig.json`
Expected: exactly the 2 baseline errors, nothing new.

- [ ] **Step 3: Commit**

```bash
git add mobile/contexts/TutorialContext.tsx
git commit -m "feat(mobile): add TutorialContext for onboarding walkthrough state"
```

---

### Task 3: TutorialOverlay component

**Files:**
- Create: `mobile/components/ui/TutorialOverlay.tsx`

**Interfaces:**
- Consumes: `useTutorial()` from `@/contexts/TutorialContext` (Task 2); `useThemeColors()` from `@/contexts/ThemeContext`; `Text` from `./Text`; `Button` from `./Button`; `Spacing`, `Radius` from `@/constants/theme`.
- Produces: `TutorialOverlay` component (no props) — consumed by Task 4 (mounted once at root).

- [ ] **Step 1: Write the file**

```tsx
import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Spacing, Radius } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { Text } from './Text';
import { Button } from './Button';

export function TutorialOverlay() {
  const { active, stepIndex, step, totalSteps, next, back, stop } = useTutorial();
  const c = useThemeColors();

  if (!active) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;

  return (
    <Modal visible={active} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 2, marginBottom: Spacing[3] }}>
            {step.title.toUpperCase()}
          </Text>
          <Text variant="serif" color="secondary" style={{ lineHeight: 26 }}>
            {step.body}
          </Text>

          <View style={styles.dotRow}>
            {Array.from({ length: totalSteps }, (_, i) => i).map((i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: i === stepIndex ? c.text : 'transparent',
                    borderColor: i === stepIndex ? c.text : c.border,
                  },
                ]}
              />
            ))}
          </View>

          <View style={styles.controlRow}>
            <Pressable onPress={stop} hitSlop={12}>
              <Text variant="monoSmall" style={{ color: c.faint, letterSpacing: 1 }}>
                skip tutorial
              </Text>
            </Pressable>
            <View style={styles.buttonGroup}>
              {!isFirst && (
                <Button
                  label="back"
                  variant="tertiary"
                  size="sm"
                  onPress={back}
                  style={{ marginRight: Spacing[3] }}
                />
              )}
              <Button
                label={isLast ? 'start exploring' : 'next'}
                variant="primary"
                size="sm"
                onPress={isLast ? stop : next}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[16],
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[6],
  },
  dotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Spacing[5],
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    marginRight: Spacing[2],
    marginBottom: Spacing[2],
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[5],
  },
  buttonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
```

- [ ] **Step 2: Typecheck**

Run (from `mobile/`): `npx tsc --noEmit --project tsconfig.json`
Expected: exactly the 2 baseline errors, nothing new.

- [ ] **Step 3: Commit**

```bash
git add mobile/components/ui/TutorialOverlay.tsx
git commit -m "feat(mobile): add TutorialOverlay UI matching InfoModal's visual style"
```

---

### Task 4: Wire provider and overlay into the root layout

**Files:**
- Modify: `mobile/app/_layout.tsx`

**Interfaces:**
- Consumes: `TutorialProvider` from `@/contexts/TutorialContext` (Task 2); `TutorialOverlay` from `@/components/ui/TutorialOverlay` (Task 3).

- [ ] **Step 1: Add imports**

In `mobile/app/_layout.tsx`, add after the existing `AuthProvider` import (currently line 9):

```tsx
import { TutorialProvider } from '@/contexts/TutorialContext';
import { TutorialOverlay } from '@/components/ui/TutorialOverlay';
```

- [ ] **Step 2: Wrap the stack with `TutorialProvider` and mount the overlay**

Replace the current return block:

```tsx
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ShareIntentProvider>
        <ThemeProvider>
          <AuthProvider>
            <ThemedStatusBar />
            <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="insight/[id]" options={{ presentation: 'card' }} />
              <Stack.Screen name="profile/edit" options={{ presentation: 'modal' }} />
              <Stack.Screen name="settings" options={{ presentation: 'card' }} />
              <Stack.Screen name="shareintent" options={{ presentation: 'modal' }} />
              <Stack.Screen name="+not-found" />
            </Stack>
          </AuthProvider>
        </ThemeProvider>
      </ShareIntentProvider>
    </GestureHandlerRootView>
  );
```

with:

```tsx
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ShareIntentProvider>
        <ThemeProvider>
          <AuthProvider>
            <TutorialProvider>
              <ThemedStatusBar />
              <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="insight/[id]" options={{ presentation: 'card' }} />
                <Stack.Screen name="profile/edit" options={{ presentation: 'modal' }} />
                <Stack.Screen name="settings" options={{ presentation: 'card' }} />
                <Stack.Screen name="shareintent" options={{ presentation: 'modal' }} />
                <Stack.Screen name="+not-found" />
              </Stack>
              <TutorialOverlay />
            </TutorialProvider>
          </AuthProvider>
        </ThemeProvider>
      </ShareIntentProvider>
    </GestureHandlerRootView>
  );
```

- [ ] **Step 3: Typecheck**

Run (from `mobile/`): `npx tsc --noEmit --project tsconfig.json`
Expected: exactly the 2 baseline errors, nothing new.

- [ ] **Step 4: Manual smoke check**

Run the mobile app (`cd mobile && EXPO_NO_DOCKER=1 npx expo start --ios -c`) and confirm it launches with no crash and no visible change to any screen (the overlay must render nothing while `active` is false).

- [ ] **Step 5: Commit**

```bash
git add mobile/app/_layout.tsx
git commit -m "feat(mobile): mount TutorialProvider and TutorialOverlay at app root"
```

---

### Task 5: Auto-start the tutorial after sign-up

**Files:**
- Modify: `mobile/app/(onboarding)/preview.tsx`

**Interfaces:**
- Consumes: `useTutorial()` from `@/contexts/TutorialContext` (Task 2).

- [ ] **Step 1: Import the hook**

Add after the existing `useAuth` import (currently line 5):

```tsx
import { useTutorial } from '@/contexts/TutorialContext';
```

- [ ] **Step 2: Call `start()` from the tutorial context after navigating to the tabs**

Replace:

```tsx
  const c = useThemeColors();
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const [, setFinishing] = useState(false);

  const { data: captures } = useApiQuery(() => api.captures.list({ limit: 3 }), []);
  const first = captures?.[0];

  const finish = useCallback(async () => {
    setFinishing(true);
    await refreshProfile();
    router.replace('/(tabs)');
  }, [refreshProfile, router]);
```

with:

```tsx
  const c = useThemeColors();
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const { start: startTutorial } = useTutorial();
  const [, setFinishing] = useState(false);

  const { data: captures } = useApiQuery(() => api.captures.list({ limit: 3 }), []);
  const first = captures?.[0];

  const finish = useCallback(async () => {
    setFinishing(true);
    await refreshProfile();
    router.replace('/(tabs)');
    startTutorial();
  }, [refreshProfile, router, startTutorial]);
```

- [ ] **Step 3: Typecheck**

Run (from `mobile/`): `npx tsc --noEmit --project tsconfig.json`
Expected: exactly the 2 baseline errors, nothing new.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(onboarding)/preview.tsx"
git commit -m "feat(mobile): auto-start onboarding tutorial after sign-up"
```

---

### Task 6: Add the manual-replay button to Atlas

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `useTutorial()` from `@/contexts/TutorialContext` (Task 2).

- [ ] **Step 1: Import the hook**

Add after the existing `InfoModal` import (currently line 38):

```tsx
import { useTutorial } from '@/contexts/TutorialContext';
```

- [ ] **Step 2: Call the hook inside `MapScreen`**

In `MapScreen` (currently starting at line 971), change:

```tsx
export default function MapScreen() {
  const c = useThemeColors();
  const { setMode: setThemeMode } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [infoVisible, setInfoVisible] = useState(false);
```

to:

```tsx
export default function MapScreen() {
  const c = useThemeColors();
  const { setMode: setThemeMode } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { start: startTutorial } = useTutorial();
  const [infoVisible, setInfoVisible] = useState(false);
```

- [ ] **Step 3: Add the `ⓣ` button next to the `ⓘ` button**

Currently (lines 2284-2295):

```tsx
              <View style={styles.headerTitleRow} pointerEvents="box-none">
                <Text variant="wordmark" style={{ color: 'rgba(236,236,236,0.85)' }}>atlas</Text>
                <Pressable
                  onPress={() => setInfoVisible(true)}
                  hitSlop={12}
                  accessibilityLabel="About atlas"
                  style={{ marginLeft: Spacing[3] }}
                  pointerEvents="auto"
                >
                  <Text style={{ color: 'rgba(236,236,236,0.35)', fontSize: 16 }}>ⓘ</Text>
                </Pressable>
              </View>
```

Change to:

```tsx
              <View style={styles.headerTitleRow} pointerEvents="box-none">
                <Text variant="wordmark" style={{ color: 'rgba(236,236,236,0.85)' }}>atlas</Text>
                <Pressable
                  onPress={() => setInfoVisible(true)}
                  hitSlop={12}
                  accessibilityLabel="About atlas"
                  style={{ marginLeft: Spacing[3] }}
                  pointerEvents="auto"
                >
                  <Text style={{ color: 'rgba(236,236,236,0.35)', fontSize: 16 }}>ⓘ</Text>
                </Pressable>
                <Pressable
                  onPress={() => startTutorial()}
                  hitSlop={12}
                  accessibilityLabel="Start tutorial"
                  style={{ marginLeft: Spacing[3] }}
                  pointerEvents="auto"
                >
                  <Text style={{ color: 'rgba(236,236,236,0.35)', fontSize: 16 }}>ⓣ</Text>
                </Pressable>
              </View>
```

- [ ] **Step 4: Typecheck**

Run (from `mobile/`): `npx tsc --noEmit --project tsconfig.json`
Expected: exactly the 2 baseline errors (`app/(tabs)/index.tsx:635-636`), nothing new.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/index.tsx"
git commit -m "feat(mobile): add tutorial replay button next to Atlas info button"
```

---

### Task 7: Manual end-to-end verification

No code changes. Run the mobile app (`cd mobile && EXPO_NO_DOCKER=1 npx expo start --ios -c`) against a real or local backend and walk through:

- [ ] **Step 1: Fresh sign-up auto-starts the tutorial**
  Sign up a new account, complete `topics` → `identity` → `starter-links` → `preview`, tap "Start". Confirm the tutorial overlay appears on Atlas at step 1 ("welcome").

- [ ] **Step 2: Next/Back walks all six tabs**
  Tap "next" repeatedly and confirm each step lands on the correct real tab (atlas → atlas → atlas → atlas → atlas → archive → pulse → drift → mind → you → you), with the scrim visible and the tab bar not tappable underneath. Tap "back" a few times and confirm it retraces correctly, including navigating back to a previous tab.

- [ ] **Step 3: Last step reads "start exploring" and ends the tutorial**
  Confirm the final step's button reads "start exploring" (not "next") and tapping it dismisses the overlay, leaving the user on the profile tab, fully interactive.

- [ ] **Step 4: Skip works from an arbitrary step**
  Restart the tutorial, advance to a middle step, tap "skip tutorial", confirm the overlay dismisses immediately and the underlying tab is interactive again.

- [ ] **Step 5: Sign-in never auto-starts**
  Sign out, sign back in with the same account. Confirm the tutorial does **not** auto-start.

- [ ] **Step 6: Manual replay button works**
  On Atlas, confirm the new `ⓣ` button appears immediately to the right of the `ⓘ` button, same size/color/style. Tap it and confirm the tutorial restarts from step 1.

- [ ] **Step 7: Fix any issues found, then commit**
  If any of the above fail, fix the relevant task's file and re-run its typecheck step. Commit fixes separately with a `fix(mobile): ...` message describing what was wrong.
