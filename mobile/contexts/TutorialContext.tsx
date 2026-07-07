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
