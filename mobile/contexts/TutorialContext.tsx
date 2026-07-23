import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { View } from 'react-native';
import { useSegments } from 'expo-router';
import { TUTORIAL_STEPS, TutorialStep } from '@/constants/tutorialSteps';

// How long an active target keeps re-measuring itself, and how often. Covers
// the capture sheet's slide-in, a drawer animating in from the right, and any
// subtree that lays out a frame or two after the step becomes active.
const MEASURE_POLL_MS = 2500;
const MEASURE_POLL_INTERVAL_MS = 120;

export interface TutorialRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TutorialContextValue {
  active: boolean;
  stepIndex: number;
  step: TutorialStep;
  totalSteps: number;
  /** Measured rects for `registered` targets, keyed by target id. */
  targetRects: Record<string, TutorialRect>;
  start: () => void;
  /** Advance one step (card steps call this from their button). */
  next: () => void;
  stop: () => void;
  reportTargetRect: (id: string, rect: TutorialRect) => void;
  /** A registered control was pressed — advances if it's the active target. */
  notifyTargetPressed: (id: string) => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRects, setTargetRects] = useState<Record<string, TutorialRect>>({});
  const segments = useSegments();

  const step = TUTORIAL_STEPS[stepIndex];

  const start = useCallback(() => {
    setStepIndex(0);
    setTargetRects({});
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

  const reportTargetRect = useCallback((id: string, rect: TutorialRect) => {
    setTargetRects((prev) => {
      const cur = prev[id];
      if (cur && cur.x === rect.x && cur.y === rect.y && cur.width === rect.width && cur.height === rect.height) {
        return prev;
      }
      return { ...prev, [id]: rect };
    });
  }, []);

  const notifyTargetPressed = useCallback((id: string) => {
    setStepIndex((i) => {
      const s = TUTORIAL_STEPS[i];
      if (!s || s.target.kind !== 'registered' || s.target.id !== id) return i;
      if (i >= TUTORIAL_STEPS.length - 1) {
        setActive(false);
        return i;
      }
      return i + 1;
    });
  }, []);

  // Tab steps advance when the user actually navigates to the target tab. The
  // last route segment is the tab's screen name ('memory', 'pulse', …); the
  // atlas tab is the group's index route, so it reports the group segment
  // ('(tabs)') rather than a screen name.
  useEffect(() => {
    if (!active) return;
    if (step.target.kind !== 'tab') return;
    const currentSeg = segments[segments.length - 1];
    if (currentSeg === step.target.seg) next();
  }, [active, step, segments, next]);

  const value = useMemo<TutorialContextValue>(
    () => ({
      active,
      stepIndex,
      step,
      totalSteps: TUTORIAL_STEPS.length,
      targetRects,
      start,
      next,
      stop,
      reportTargetRect,
      notifyTargetPressed,
    }),
    [active, stepIndex, step, targetRects, start, next, stop, reportTargetRect, notifyTargetPressed],
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

/**
 * Wires a control into the walkthrough: attach `ref` + `onLayout` to the
 * pressable so its position can be spotlit, and call `press()` from its
 * onPress so the tutorial advances when it's the active target. Inert (all
 * no-ops, `isActive` false) whenever the tutorial isn't pointing at this id.
 */
export function useTutorialTarget(id: string) {
  const { active, step, reportTargetRect, notifyTargetPressed } = useTutorial();
  const ref = useRef<View>(null);
  const isActive = active && step.target.kind === 'registered' && step.target.id === id;

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) reportTargetRect(id, { x, y, width, height });
    });
  }, [id, reportTargetRect]);

  // Re-measure while this target is active. A fixed handful of delayed reads
  // used to be enough, but a target inside a sheet that is still sliding (or
  // whose subtree lays out late) could miss every one of them and leave the
  // step with no spotlight at all — a dimmed screen and nothing to tap. So
  // poll instead: cheap, because reportTargetRect drops an unchanged rect, and
  // it both catches a late first measurement and tracks the rect as the sheet
  // settles. Bounded so a target that genuinely never resolves stops costing
  // anything; the overlay falls back to its own button in that case.
  useEffect(() => {
    if (!isActive) return;
    measure();
    const started = Date.now();
    const poll = setInterval(() => {
      if (Date.now() - started > MEASURE_POLL_MS) {
        clearInterval(poll);
        return;
      }
      measure();
    }, MEASURE_POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [isActive, measure]);

  return {
    ref,
    onLayout: measure,
    isActive,
    press: () => notifyTargetPressed(id),
  };
}
