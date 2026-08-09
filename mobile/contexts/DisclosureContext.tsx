import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  computeTabGlows,
  glowSeenFlag,
  pickNextWhisper,
  type RevealSignals,
  type TabGlowKey,
  type WhisperId,
} from '@/lib/disclosure';
import { visitedTabFlag } from '@/lib/guide';

// Device-scoped, like the push-ask flag: a whisper teaches this install of the
// app, and re-teaching the next account on the same phone is noise.
const STORE_KEY = 'mneme_disclosure_v1';

// Breathing room after a whisper retires before the next one may speak. Two
// lines back-to-back read as a queue draining, which is exactly the feeling
// the one-at-a-time rule exists to prevent.
const WHISPER_GAP_MS = 30_000;

interface DisclosureContextValue {
  /** Persisted state has loaded; nothing fires before this. */
  ready: boolean;
  hasSeen: (flag: string) => boolean;
  /** Durably record a flag (event flags, glow retirements, whisper ids). */
  markSeen: (flag: string) => void;
  /** The single whisper allowed on screen right now. */
  activeWhisper: WhisperId | null;
  /**
   * Nominate a whisper whose condition currently holds. Arbitration picks the
   * highest-priority unseen candidate whenever nothing is showing. Safe to
   * call repeatedly; a seen id never re-fires.
   */
  offerWhisper: (id: WhisperId) => void;
  /** Withdraw a nomination (condition stopped holding / anchor unmounted). */
  retractWhisper: (id: WhisperId) => void;
  /** The active whisper finished (tapped or timed out). Already marked seen. */
  dismissWhisper: () => void;
  /** Reveal signals are re-derived from server data each session, never stored. */
  setSignals: (partial: Partial<RevealSignals>) => void;
  glows: Record<TabGlowKey, boolean>;
  /** Call on tab focus: visiting a glowing tab retires its glow forever. */
  noteTabFocus: (tab: string) => void;
}

const DisclosureContext = createContext<DisclosureContextValue | null>(null);

const GLOW_TABS: TabGlowKey[] = ['mind', 'archive', 'you', 'pulse'];

export function DisclosureProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<WhisperId[]>([]);
  const [activeWhisper, setActiveWhisper] = useState<WhisperId | null>(null);
  const [signals, setSignalsState] = useState<RevealSignals>({
    captureCount: 0,
    hasOwnEdge: false,
  });
  const shownThisSessionRef = useRef(0);
  const lastShownAtRef = useRef(0);
  const seenRef = useRef(seen);
  seenRef.current = seen;

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw) {
          const parsed = JSON.parse(raw) as { seen?: string[] };
          if (Array.isArray(parsed.seen)) {
            setSeen(new Set(parsed.seen));
          }
        }
      })
      .catch(() => {
        // Unreadable store = fresh start; worst case a whisper repeats once.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markSeen = useCallback((flag: string) => {
    setSeen((prev) => {
      if (prev.has(flag)) return prev;
      const next = new Set(prev);
      next.add(flag);
      AsyncStorage.setItem(STORE_KEY, JSON.stringify({ seen: [...next] })).catch(() => {});
      return next;
    });
  }, []);

  const hasSeen = useCallback((flag: string) => seen.has(flag), [seen]);

  const offerWhisper = useCallback((id: WhisperId) => {
    setPending((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const retractWhisper = useCallback((id: WhisperId) => {
    setPending((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : prev));
  }, []);

  const dismissWhisper = useCallback(() => {
    setActiveWhisper(null);
  }, []);

  // Arbitration. Marked seen at activation, not dismissal — "fires exactly
  // once" counts an appearance the user never tapped.
  useEffect(() => {
    if (!ready || activeWhisper || pending.length === 0) return;

    const activate = () => {
      const pick = pickNextWhisper(pending, seenRef.current, shownThisSessionRef.current);
      if (!pick) return;
      shownThisSessionRef.current += 1;
      lastShownAtRef.current = Date.now();
      markSeen(pick);
      setPending((prev) => prev.filter((p) => p !== pick));
      setActiveWhisper(pick);
    };

    const sinceLast = Date.now() - lastShownAtRef.current;
    if (lastShownAtRef.current === 0 || sinceLast >= WHISPER_GAP_MS) {
      activate();
      return;
    }
    const timer = setTimeout(activate, WHISPER_GAP_MS - sinceLast);
    return () => clearTimeout(timer);
  }, [ready, activeWhisper, pending, markSeen]);

  const setSignals = useCallback((partial: Partial<RevealSignals>) => {
    setSignalsState((prev) => {
      const next = { ...prev, ...partial };
      if (next.captureCount === prev.captureCount && next.hasOwnEdge === prev.hasOwnEdge) {
        return prev;
      }
      return next;
    });
  }, []);

  const glows = useMemo(
    () => (ready ? computeTabGlows(signals, seen) : { mind: false, archive: false, you: false, pulse: false }),
    [ready, signals, seen],
  );

  const noteTabFocus = useCallback(
    (tab: string) => {
      // Every tab remembers its first visit — the onboarding guide advances
      // off these, so a lesson about a place the user already found is never
      // shown.
      markSeen(visitedTabFlag(tab));
      if ((GLOW_TABS as string[]).includes(tab) && glows[tab as TabGlowKey]) {
        markSeen(glowSeenFlag(tab as TabGlowKey));
      }
    },
    [glows, markSeen],
  );

  const value = useMemo<DisclosureContextValue>(
    () => ({
      ready,
      hasSeen,
      markSeen,
      activeWhisper,
      offerWhisper,
      retractWhisper,
      dismissWhisper,
      setSignals,
      glows,
      noteTabFocus,
    }),
    [ready, hasSeen, markSeen, activeWhisper, offerWhisper, retractWhisper, dismissWhisper, setSignals, glows, noteTabFocus],
  );

  return <DisclosureContext.Provider value={value}>{children}</DisclosureContext.Provider>;
}

export function useDisclosure(): DisclosureContextValue {
  const ctx = useContext(DisclosureContext);
  if (!ctx) {
    throw new Error('useDisclosure must be used within a DisclosureProvider');
  }
  return ctx;
}

/**
 * Nominate a whisper while `when` holds and the anchor is mounted. Returns
 * whether this whisper is the one currently speaking; the anchor renders its
 * line only then.
 */
export function useWhisper(id: WhisperId, when: boolean): boolean {
  const { ready, activeWhisper, offerWhisper, retractWhisper } = useDisclosure();

  useEffect(() => {
    if (!ready || !when) return;
    offerWhisper(id);
    return () => retractWhisper(id);
  }, [ready, when, id, offerWhisper, retractWhisper]);

  return activeWhisper === id;
}
