import React, { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Confetti } from '@/components/ui/Confetti';
import type { WrappedStats } from '@/types/api';

function clampWorklet(v: number, min: number, max: number): number {
  'worklet';
  return v < min ? min : v > max ? max : v;
}

function formatHour(h: number): string {
  if (h === 0) return 'midnight';
  if (h === 12) return 'noon';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function formatMonthYear(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

const ARCHETYPES: Record<string, { name: string; line: string }> = {
  link: { name: 'The Link Hoarder', line: 'Every tab open, forever, just in case.' },
  text: { name: 'The Note-Taker', line: 'You type the thought before it can run off.' },
  quote: { name: 'The Quote Collector', line: 'Other people said it better and you kept the receipts.' },
  image: { name: 'The Screenshotter', line: 'Why write it down when you can just screenshot it.' },
};

/** Counts from 0 to `value` on the JS thread once `active` flips true. */
function useCountUp(value: number, active: boolean): number {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = Date.now();
    const dur = 1000;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, value]);
  return display;
}

/**
 * A card that fades + slides in as it scrolls into view. Reveal is derived on
 * the UI thread from the parent scroll offset and the card's own position, so it
 * tracks the finger instead of firing once on mount.
 */
function RevealCard({
  scrollY,
  sectionY,
  screenH,
  onReveal,
  children,
  style,
}: {
  scrollY: SharedValue<number>;
  sectionY: SharedValue<number>;
  screenH: number;
  onReveal?: () => void;
  children: React.ReactNode;
  style?: object;
}) {
  const c = useThemeColors();
  const cardY = useSharedValue(0);
  const measured = useSharedValue(0);
  const fired = useSharedValue(0);

  const anim = useAnimatedStyle(() => {
    if (measured.value === 0) {
      return { opacity: 0, transform: [{ translateY: 28 }, { scale: 0.96 }] };
    }
    const absY = sectionY.value + cardY.value;
    const p = clampWorklet((scrollY.value + screenH - absY - 60) / 90, 0, 1);
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * 28 }, { scale: 0.96 + p * 0.04 }],
    };
  });

  useAnimatedReaction(
    () => {
      if (measured.value === 0) return -1;
      const absY = sectionY.value + cardY.value;
      return (scrollY.value + screenH - absY - 60) / 90;
    },
    (p) => {
      if (p > 0.6 && fired.value === 0) {
        fired.value = 1;
        if (onReveal) runOnJS(onReveal)();
      }
    },
  );

  return (
    <Animated.View
      onLayout={(e) => {
        cardY.value = e.nativeEvent.layout.y;
        measured.value = 1;
      }}
      style={[styles.card, { borderColor: c.border, backgroundColor: c.surface }, style, anim]}
    >
      {children}
    </Animated.View>
  );
}

function Chips({ items }: { items: { name: string; count?: number }[] }) {
  const c = useThemeColors();
  return (
    <View style={styles.chipRow}>
      {items.map((it) => (
        <View key={it.name} style={[styles.chip, { borderColor: c.border }]}>
          <Text variant="mono" color="secondary">
            {it.name}
            {it.count ? ` ·${it.count}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

function MiniArc({ arc }: { arc: WrappedStats['monthlyArc'] }) {
  const c = useThemeColors();
  const max = Math.max(1, ...arc.map((m) => m.count));
  return (
    <View style={styles.arcRow}>
      {arc.map((m) => (
        <View key={m.month} style={styles.arcCol}>
          <View
            style={[
              styles.arcBar,
              { height: 4 + (m.count / max) * 40, backgroundColor: c.text },
            ]}
          />
          <Text variant="monoSmall" style={{ color: c.faint, fontSize: 9 }}>
            {m.month.slice(5)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function WrappedSection({ scrollY }: { scrollY: SharedValue<number> }) {
  const c = useThemeColors();
  const { height: screenH } = useWindowDimensions();
  const sectionY = useSharedValue(0);
  const { data: w } = useApiQuery(() => api.profile.wrapped(), []);

  const [heroActive, setHeroActive] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const heroCount = useCountUp(w?.totalCaptures ?? 0, heroActive);

  if (!w) return null;

  const fireHero = () => {
    setHeroActive(true);
    setConfettiKey((k) => k + 1);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const cardProps = { scrollY, sectionY, screenH };
  const topFormat = w.formats[0]?.name;
  const archetype = topFormat ? ARCHETYPES[topFormat] : undefined;

  return (
    <View
      onLayout={(e) => {
        sectionY.value = e.nativeEvent.layout.y;
      }}
      style={styles.section}
    >
      <Text variant="label" color="muted" style={styles.kicker}>
        your mneme, wrapped
      </Text>

      {/* Hero — milestone + confetti */}
      <RevealCard {...cardProps} onReveal={fireHero} style={styles.hero}>
        <Confetti trigger={confettiKey} />
        {w.totalCaptures === 0 ? (
          <>
            <Text variant="h2" style={styles.heroTitle}>
              Nothing saved yet
            </Text>
            <Text variant="serif" color="secondary" style={styles.heroBody}>
              Save one thing and this whole page turns into your greatest hits. No pressure. Okay, a little pressure.
            </Text>
          </>
        ) : w.totalCaptures === 1 ? (
          <>
            <Text variant="hero" style={styles.heroNumber}>
              1
            </Text>
            <Text variant="serif" color="secondary" style={styles.heroBody}>
              Your first save. Kind of a big deal. We're not emotional, you're emotional.
            </Text>
          </>
        ) : (
          <>
            <Text variant="hero" style={styles.heroNumber}>
              {heroCount}
            </Text>
            <Text variant="mono" color="muted">
              things worth keeping
            </Text>
            {w.firstCaptureAt ? (
              <Text variant="serif" color="secondary" style={styles.heroBody}>
                All since {formatMonthYear(w.firstCaptureAt)}. Your brain has been busy.
              </Text>
            ) : null}
          </>
        )}
      </RevealCard>

      {w.topTopics.length > 0 ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            You can't stop thinking about {w.topTopics[0].name.toLowerCase()}.
          </Text>
          <Chips items={w.topTopics} />
        </RevealCard>
      ) : null}

      {w.newTopicsThisMonth.length > 0 ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            Fresh rabbit holes this month
          </Text>
          <Chips items={w.newTopicsThisMonth.slice(0, 6).map((name) => ({ name }))} />
        </RevealCard>
      ) : null}

      {w.busiestDayOfWeek && w.busiestHour !== null ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            Peak brain: {w.busiestDayOfWeek}s, around {formatHour(w.busiestHour)}.
          </Text>
          <Text variant="mono" color="muted" style={{ marginTop: Spacing[2] }}>
            We see you.
          </Text>
        </RevealCard>
      ) : null}

      {w.longestStreak >= 2 ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            {w.longestStreak} days straight, once. Iconic.
          </Text>
          {w.currentStreak >= 2 ? (
            <Text variant="mono" color="muted" style={{ marginTop: Spacing[2] }}>
              Currently {w.currentStreak} days deep. Don't look down.
            </Text>
          ) : null}
        </RevealCard>
      ) : null}

      {archetype ? (
        <RevealCard {...cardProps}>
          <Text variant="mono" color="muted">
            your type
          </Text>
          <Text variant="h3" style={{ marginTop: Spacing[1] }}>
            {archetype.name}
          </Text>
          <Text variant="serif" color="secondary" style={{ marginTop: Spacing[2] }}>
            {archetype.line}
          </Text>
        </RevealCard>
      ) : null}

      {w.totalCaptures > 0 ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            Your last six months, in little bars
          </Text>
          <MiniArc arc={w.monthlyArc} />
        </RevealCard>
      ) : null}

      {w.firstCaptureAt ? (
        <RevealCard {...cardProps}>
          <Text variant="mono" color="muted">
            it started {formatMonthYear(w.firstCaptureAt)}
          </Text>
          <Text variant="serif" color="secondary" style={{ marginTop: Spacing[1] }}>
            Look at you now.
          </Text>
        </RevealCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: Spacing[6],
    marginTop: Spacing[6],
  },
  kicker: {
    marginBottom: Spacing[3],
  },
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
    marginBottom: Spacing[3],
    overflow: 'hidden',
  },
  hero: {
    alignItems: 'center',
    paddingVertical: Spacing[8],
    minHeight: 180,
    justifyContent: 'center',
  },
  heroNumber: {
    fontSize: 72,
    lineHeight: 78,
  },
  heroTitle: {
    textAlign: 'center',
  },
  heroBody: {
    textAlign: 'center',
    marginTop: Spacing[3],
    maxWidth: 300,
  },
  cardTitle: {
    lineHeight: 26,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginTop: Spacing[4],
  },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1],
  },
  arcRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: Spacing[5],
    height: 60,
  },
  arcCol: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  arcBar: {
    width: 18,
    borderRadius: 2,
  },
});
