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
  /** Runtime override of the current step's body — e.g. explaining a failure
   * state (a source that couldn't be read) the moment it actually happens. */
  note: string | null;
  setStepNote: (note: string | null) => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRects, setTargetRects] = useState<Record<string, TutorialRect>>({});
  const [note, setStepNote] = useState<string | null>(null);
  const segments = useSegments();

  const step = TUTORIAL_STEPS[stepIndex];

  // Any override only ever applies to the step it was set for.
  useEffect(() => {
    setStepNote(null);
  }, [stepIndex]);

  const start = useCallback(() => {
    setStepIndex(0);
    setTargetRects({});
    setStepNote(null);
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
  // atlas/index tab reports the group segment ('(tabs)') instead.
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
      note,
      setStepNote,
    }),
    [active, stepIndex, step, targetRects, start, next, stop, reportTargetRect, notifyTargetPressed, note],
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

  // Re-measure when this target becomes active: the capture sheet slides in, so
  // one immediate read plus a couple of delayed reads catch its settled rect.
  useEffect(() => {
    if (!isActive) return;
    measure();
    const timers = [80, 320, 600].map((ms) => setTimeout(measure, ms));
    return () => timers.forEach(clearTimeout);
  }, [isActive, measure]);

  return {
    ref,
    onLayout: measure,
    isActive,
    press: () => notifyTargetPressed(id),
  };
}
