import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Image as ImageIcon, Link2, PenLine } from 'lucide-react-native';
import { Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { Avatar } from '@/components/ui/Avatar';
import { Confetti } from '@/components/ui/Confetti';
import {
  archetypeFor,
  currentStreakLine,
  emptyBody,
  emptyTitle,
  fieldsTitle,
  firstFollowCaption,
  formatHour,
  heroNoun,
  longestStreakLine,
  milestoneLine,
  newTopicsTitle,
  noFollowLine,
  quietWeekLine,
  rhythmLine,
  sinceLine,
  timelineTitle,
  topicsTitle,
} from './copy';
import type { ArchetypeFormat } from './copy';
import type { ArcBucket, WrappedArcs, WrappedStats } from '@/types/api';

const ARCHETYPE_ICONS: Record<ArchetypeFormat, typeof Link2> = {
  link: Link2,
  text: PenLine,
  image: ImageIcon,
};

function clampWorklet(v: number, min: number, max: number): number {
  'worklet';
  return v < min ? min : v > max ? max : v;
}

const EMPTY_ARCS: WrappedArcs = { hours: [], days: [], weeks: [], months: [] };

/** Counts to `value`, resuming from whatever is already on screen. */
function useCountUp(value: number, active: boolean): number {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const from = fromRef.current;
    if (from === value) return;
    let raf = 0;
    const start = Date.now();
    const dur = 900;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (value - from) * eased);
      fromRef.current = next;
      setDisplay(next);
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

/* ------------------------------------------------------------------ hero --- */

interface HeroStat {
  value: number;
  label: string;
}

function Hero({ w, active, onCycle }: { w: WrappedStats; active: boolean; onCycle: () => void }) {
  const stats = useMemo<HeroStat[]>(() => {
    const all: HeroStat[] = [{ value: w.totalCaptures, label: heroNoun(w.totalCaptures) }];
    if (w.distinctTopics > 0) all.push({ value: w.distinctTopics, label: 'topics in orbit' });
    if (w.daysSinceFirst > 0) all.push({ value: w.daysSinceFirst, label: 'days since day one' });
    if (w.longestStreak >= 2) all.push({ value: w.longestStreak, label: 'day best streak' });
    return all;
  }, [w.totalCaptures, w.distinctTopics, w.daysSinceFirst, w.longestStreak]);

  const [index, setIndex] = useState(0);
  const safeIndex = index % stats.length;
  const stat = stats[safeIndex];
  const count = useCountUp(stat.value, active);

  const handlePress = () => {
    if (stats.length < 2) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = (safeIndex + 1) % stats.length;
    setIndex(next);
    if (next === 0) onCycle();
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole={stats.length > 1 ? 'button' : undefined}
      accessibilityLabel={`${stat.value} ${stat.label}. Tap to see another number.`}
      style={styles.heroInner}
    >
      <Text variant="hero" style={styles.heroNumber}>
        {count}
      </Text>
      <Text variant="mono" color="muted">
        {stat.label}
      </Text>
      {safeIndex === 0 ? (
        <Text variant="serif" color="secondary" style={styles.heroBody}>
          {milestoneLine(w.totalCaptures)}
        </Text>
      ) : null}
      {stats.length > 1 ? <Dots total={stats.length} active={safeIndex} /> : null}
    </Pressable>
  );
}

function Dots({ total, active }: { total: number; active: number }) {
  const c = useThemeColors();
  return (
    <View style={styles.dotRow}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: c.text, opacity: i === active ? 0.85 : 0.2 },
          ]}
        />
      ))}
    </View>
  );
}

/* ---------------------------------------------------------------- fields --- */

/** One rounded bar split by share, so the leader is a length rather than a chip. */
function Spectrum({ items }: { items: { name: string; count: number }[] }) {
  const c = useThemeColors();
  const total = items.reduce((sum, it) => sum + it.count, 0) || 1;

  return (
    <View style={styles.spectrumWrap}>
      <View style={[styles.spectrumBar, { backgroundColor: c.elevated }]}>
        {items.map((it, i) => (
          <View
            key={it.name}
            style={{ flex: it.count, backgroundColor: c.text, opacity: 1 - i * 0.16 }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {items.map((it, i) => (
          <View key={it.name} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: c.text, opacity: 1 - i * 0.16 }]} />
            <Text variant="serif" style={styles.legendName} numberOfLines={1}>
              {it.name}
            </Text>
            <Text variant="monoSmall" color="faint">
              {Math.round((it.count / total) * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- topics --- */

/** Topics as type, sized by how often they show up. No boxes, no chips. */
function TopicMass({ items }: { items: { name: string; count: number }[] }) {
  const max = Math.max(...items.map((it) => it.count));
  const min = Math.min(...items.map((it) => it.count));
  const span = Math.max(1, max - min);

  return (
    <View style={styles.massWrap}>
      {items.map((it, i) => {
        const weight = (it.count - min) / span;
        const size = 16 + weight * 20;
        return (
          <Text
            key={it.name}
            variant="serif"
            style={{
              fontSize: size,
              lineHeight: size * 1.25,
              opacity: 1 - Math.min(i, 4) * 0.13,
            }}
          >
            {it.name}
          </Text>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------ new topics --- */

function Ledger({ items }: { items: string[] }) {
  const c = useThemeColors();
  return (
    <View style={styles.ledger}>
      {items.map((name, i) => (
        <View key={name} style={[styles.ledgerRow, { borderTopColor: c.borderSubtle }]}>
          <Text variant="monoSmall" color="faint" style={styles.ledgerIndex}>
            {String(i + 1).padStart(2, '0')}
          </Text>
          <Text variant="serif" style={styles.ledgerName} numberOfLines={1}>
            {name}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ---------------------------------------------------------------- rhythm --- */

const DIAL = 148;
const DIAL_R = 44;
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** 24 spokes around a clock face. The peak hour gets the dot. */
function RhythmDial({
  hours,
  weekdays,
  peakHour,
}: {
  hours: number[];
  weekdays: number[];
  peakHour: number;
}) {
  const c = useThemeColors();
  const maxHour = Math.max(1, ...hours);
  const maxDay = Math.max(1, ...weekdays);
  const peakDay = weekdays.indexOf(maxDay);
  const center = DIAL / 2;

  return (
    <View style={styles.rhythmWrap}>
      <View style={styles.dialWrap}>
        <Svg width={DIAL} height={DIAL}>
          <Circle cx={center} cy={center} r={DIAL_R - 8} stroke={c.border} strokeWidth={1} fill="none" />
          {hours.map((count, hour) => {
            const angle = ((hour / 24) * 360 - 90) * (Math.PI / 180);
            const len = 6 + (count / maxHour) * 26;
            const x1 = center + Math.cos(angle) * DIAL_R;
            const y1 = center + Math.sin(angle) * DIAL_R;
            const x2 = center + Math.cos(angle) * (DIAL_R + len);
            const y2 = center + Math.sin(angle) * (DIAL_R + len);
            const isPeak = hour === peakHour;
            return (
              <React.Fragment key={hour}>
                <Line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={c.text}
                  strokeWidth={isPeak ? 3 : 1.5}
                  strokeLinecap="round"
                  opacity={count === 0 ? 0.12 : isPeak ? 1 : 0.35 + (count / maxHour) * 0.4}
                />
                {isPeak ? (
                  <Circle cx={x2} cy={y2} r={3} fill={c.text} />
                ) : null}
              </React.Fragment>
            );
          })}
        </Svg>
        <View style={styles.dialCenter} pointerEvents="none">
          <Text variant="monoSmall" color="muted">
            {formatHour(peakHour)}
          </Text>
        </View>
      </View>

      <View style={styles.weekRow}>
        {weekdays.map((count, i) => (
          <View key={i} style={styles.weekCol}>
            <View
              style={[
                styles.weekBar,
                {
                  height: 3 + (count / maxDay) * 26,
                  backgroundColor: c.text,
                  opacity: i === peakDay ? 0.9 : 0.22,
                },
              ]}
            />
            <Text variant="monoSmall" style={{ color: i === peakDay ? c.text : c.faint, fontSize: 9 }}>
              {WEEKDAY_INITIALS[i]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- streak --- */

function StreakStrip({ days, currentStreak }: { days: ArcBucket[]; currentStreak: number }) {
  const c = useThemeColors();
  const max = Math.max(1, ...days.map((d) => d.count));
  const liveFrom = days.length - currentStreak;

  return (
    <View style={styles.streakStrip}>
      {days.map((d, i) => {
        const live = currentStreak > 0 && i >= liveFrom;
        return (
          <View
            key={i}
            style={[
              styles.streakDot,
              d.count > 0
                ? { backgroundColor: c.text, opacity: live ? 1 : 0.35 + (d.count / max) * 0.4 }
                : { borderWidth: 1, borderColor: c.border },
            ]}
          />
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------- timeline --- */

const RANGES = [
  { key: 'hours', label: '24h' },
  { key: 'days', label: '30d' },
  { key: 'weeks', label: '12w' },
  { key: 'months', label: '6m' },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

/** Open on the narrowest range with enough history to look like something. */
function defaultRange(daysSinceFirst: number): RangeKey {
  if (daysSinceFirst < 2) return 'hours';
  if (daysSinceFirst < 25) return 'days';
  if (daysSinceFirst < 80) return 'weeks';
  return 'months';
}

function Bar({ height, delay, dim }: { height: number; delay: number; dim: boolean }) {
  const c = useThemeColors();
  const h = useSharedValue(2);

  useEffect(() => {
    h.value = withDelay(delay, withTiming(height, { duration: 420 }));
  }, [delay, h, height]);

  const anim = useAnimatedStyle(() => ({ height: h.value }));

  return (
    <Animated.View
      style={[styles.bar, { backgroundColor: c.text, opacity: dim ? 0.18 : 0.75 }, anim]}
    />
  );
}

function Timeline({ arcs, daysSinceFirst, seed }: { arcs: WrappedArcs; daysSinceFirst: number; seed: number }) {
  const c = useThemeColors();
  const [range, setRange] = useState<RangeKey>(() => defaultRange(daysSinceFirst));
  const buckets = arcs[range];
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const peak = buckets.reduce((best, b, i) => (b.count > buckets[best].count ? i : best), 0);
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  const select = (key: RangeKey) => {
    if (key === range) return;
    void Haptics.selectionAsync();
    setRange(key);
  };

  return (
    <>
      <Text variant="serif" style={styles.cardTitle}>
        {timelineTitle(seed)}
      </Text>
      <View style={[styles.segmented, { borderColor: c.border }]}>
        {RANGES.map((r) => {
          const on = r.key === range;
          return (
            <Pressable
              key={r.key}
              onPress={() => select(r.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.segment, on && { backgroundColor: c.text }]}
            >
              <Text variant="monoSmall" style={{ color: on ? c.inverseText : c.muted, fontSize: 11 }}>
                {r.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {total === 0 ? (
        <Text variant="mono" color="faint" style={styles.timelineEmpty}>
          Nothing in this window.
        </Text>
      ) : (
        <>
          <View style={styles.barRow} key={range}>
            {buckets.map((b, i) => (
              <View key={i} style={styles.barCol}>
                {i === peak ? <View style={[styles.peakDot, { backgroundColor: c.text }]} /> : null}
                <Bar height={2 + (b.count / max) * 58} delay={i * 14} dim={b.count === 0} />
              </View>
            ))}
          </View>
          <View style={styles.axisRow}>
            <Text variant="monoSmall" color="faint" style={styles.axisLabel}>
              {buckets[0].label}
            </Text>
            <Text variant="monoSmall" color="faint" style={styles.axisLabel}>
              {buckets[buckets.length - 1].label}
            </Text>
          </View>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- social --- */

function StatPair({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.statPair}>
      <Text variant="h2">{value}</Text>
      <Text variant="monoSmall" color="faint">
        {label}
      </Text>
    </View>
  );
}

function Social({ w, seed }: { w: WrappedStats; seed: number }) {
  const c = useThemeColors();

  if (w.followingCount === 0 && w.followerCount === 0) {
    return (
      <Text variant="serif" color="secondary" style={styles.cardTitle}>
        {noFollowLine(seed)}
      </Text>
    );
  }

  return (
    <>
      <View style={styles.statRow}>
        <StatPair value={w.followingCount} label="following" />
        <View style={[styles.statDivider, { backgroundColor: c.border }]} />
        <StatPair value={w.followerCount} label="followers" />
      </View>

      {w.firstFollow ? (
        <View style={[styles.firstFollow, { borderTopColor: c.borderSubtle }]}>
          <Avatar
            uri={w.firstFollow.avatarUrl}
            displayName={w.firstFollow.displayName}
            size="sm"
          />
          <View style={styles.firstFollowText}>
            <Text variant="serif" numberOfLines={1}>
              {w.firstFollow.displayName}
            </Text>
            <Text variant="monoSmall" color="faint">
              {firstFollowCaption(w.firstFollow.handle)}
            </Text>
          </View>
        </View>
      ) : null}

      {w.followingCount > 0 ? (
        <View style={[styles.friendRow, { borderTopColor: c.borderSubtle }]}>
          {w.friendActivity.length === 0 ? (
            <Text variant="monoSmall" color="faint">
              {quietWeekLine(seed)}
            </Text>
          ) : (
            w.friendActivity.map((f) => (
              <View key={f.handle} style={styles.friend}>
                <Avatar uri={f.avatarUrl} displayName={f.displayName} size="sm" />
                <Text variant="monoSmall" color="faint" style={{ fontSize: 9 }}>
                  +{f.count}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}
    </>
  );
}

/* ----------------------------------------------------------------- shell --- */

export function WrappedSection({
  scrollY,
  stats,
}: {
  scrollY: SharedValue<number>;
  stats: WrappedStats | null;
}) {
  const c = useThemeColors();
  const { height: screenH } = useWindowDimensions();
  const sectionY = useSharedValue(0);

  const [heroActive, setHeroActive] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);

  if (!stats) return null;
  const w = stats;
  const arcs = w.arcs ?? EMPTY_ARCS;
  const seed = w.totalCaptures * 31 + w.distinctTopics;

  const burst = () => {
    setConfettiKey((k) => k + 1);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const revealHero = () => {
    setHeroActive(true);
    if (w.totalCaptures > 0) burst();
  };

  const cardProps = { scrollY, sectionY, screenH };
  const archetype = archetypeFor(w.formats[0]?.name, seed);
  const hasRhythm = w.busiestHour !== null && w.busiestDayOfWeek !== null && w.hourHistogram?.length === 24;

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

      <RevealCard {...cardProps} onReveal={revealHero} style={styles.hero}>
        {w.totalCaptures > 0 && <Confetti trigger={confettiKey} />}
        {w.totalCaptures === 0 ? (
          <>
            <Text variant="h2" style={styles.heroTitle}>
              {emptyTitle(seed)}
            </Text>
            <Text variant="serif" color="secondary" style={styles.heroBody}>
              {emptyBody(seed)}
            </Text>
          </>
        ) : (
          <Hero w={w} active={heroActive} onCycle={burst} />
        )}
      </RevealCard>

      {w.topFields.length > 0 ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            {fieldsTitle(seed)}
          </Text>
          <Spectrum items={w.topFields} />
        </RevealCard>
      ) : null}

      {w.topTopics.length > 0 ? (
        <RevealCard {...cardProps}>
          <Text variant="monoSmall" color="faint" style={styles.overline}>
            {topicsTitle(w.topTopics[0].name, seed)}
          </Text>
          <TopicMass items={w.topTopics} />
        </RevealCard>
      ) : null}

      {w.newTopicsThisMonth.length > 0 ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            {newTopicsTitle(seed)}
          </Text>
          <Ledger items={w.newTopicsThisMonth.slice(0, 6)} />
        </RevealCard>
      ) : null}

      {hasRhythm ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            {rhythmLine(w.busiestHour!, w.busiestDayOfWeek!)}
          </Text>
          <RhythmDial
            hours={w.hourHistogram}
            weekdays={w.weekdayHistogram}
            peakHour={w.busiestHour!}
          />
        </RevealCard>
      ) : null}

      {w.longestStreak >= 2 ? (
        <RevealCard {...cardProps}>
          <View style={styles.streakHead}>
            <Text variant="hero" style={styles.streakNumber}>
              {w.longestStreak}
            </Text>
            <Text variant="serif" color="secondary" style={styles.streakLine}>
              {longestStreakLine(w.longestStreak)}
            </Text>
          </View>
          {arcs.days.length > 0 ? (
            <StreakStrip days={arcs.days} currentStreak={w.currentStreak} />
          ) : null}
          {w.currentStreak >= 2 ? (
            <Text variant="monoSmall" color="faint" style={{ marginTop: Spacing[3] }}>
              {currentStreakLine(w.currentStreak)}
            </Text>
          ) : null}
        </RevealCard>
      ) : null}

      {archetype ? (
        <RevealCard {...cardProps}>
          <View style={styles.archetypeRow}>
            <View style={[styles.glyph, { borderColor: c.border }]}>
              {React.createElement(ARCHETYPE_ICONS[archetype.format], {
                size: 24,
                color: c.text,
                strokeWidth: 1.5,
              })}
            </View>
            <View style={styles.archetypeText}>
              <Text variant="monoSmall" color="faint">
                your type
              </Text>
              <Text variant="h3">{archetype.name}</Text>
              <Text variant="serif" color="secondary" style={{ marginTop: Spacing[1] }}>
                {archetype.line}
              </Text>
            </View>
          </View>
        </RevealCard>
      ) : null}

      {w.totalCaptures > 0 && arcs.months.length > 0 ? (
        <RevealCard {...cardProps}>
          <Timeline arcs={arcs} daysSinceFirst={w.daysSinceFirst} seed={seed} />
          {w.firstCaptureAt ? (
            <Text variant="monoSmall" color="faint" style={styles.sinceLine}>
              {sinceLine(w.firstCaptureAt, w.totalCaptures)}
            </Text>
          ) : null}
        </RevealCard>
      ) : null}

      <RevealCard {...cardProps}>
        <Social w={w} seed={seed} />
      </RevealCard>
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
  cardTitle: {
    lineHeight: 26,
  },
  overline: {
    marginBottom: Spacing[4],
  },

  hero: {
    alignItems: 'center',
    paddingVertical: Spacing[8],
    minHeight: 200,
    justifyContent: 'center',
    overflow: 'visible',
  },
  heroInner: { alignItems: 'center', alignSelf: 'stretch' },
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
  dotRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: Spacing[4],
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: Radius.full,
  },

  spectrumWrap: { marginTop: Spacing[4] },
  spectrumBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  legend: { marginTop: Spacing[4], gap: Spacing[2] },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  legendName: { flex: 1 },

  massWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: Spacing[3],
    rowGap: 2,
  },

  ledger: { marginTop: Spacing[4] },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[4],
    paddingVertical: Spacing[2],
    borderTopWidth: 1,
  },
  ledgerIndex: { fontSize: 10 },
  ledgerName: { flex: 1 },

  rhythmWrap: { alignItems: 'center', marginTop: Spacing[4] },
  dialWrap: { width: DIAL, height: DIAL, alignItems: 'center', justifyContent: 'center' },
  dialCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    alignSelf: 'stretch',
    marginTop: Spacing[5],
  },
  weekCol: { flex: 1, alignItems: 'center', gap: 4 },
  weekBar: { width: 14, borderRadius: 2 },

  streakHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing[4] },
  streakNumber: { fontSize: 52, lineHeight: 56 },
  streakLine: { flex: 1, lineHeight: 24 },
  streakStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing[5],
  },
  streakDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.full,
  },

  archetypeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[5] },
  glyph: {
    width: 52,
    height: 52,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archetypeText: { flex: 1 },

  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Radius.full,
    overflow: 'hidden',
    marginTop: Spacing[4],
  },
  segment: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
  },
  timelineEmpty: { marginTop: Spacing[6], textAlign: 'center' },
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 70,
    marginTop: Spacing[5],
  },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '62%', minWidth: 3, borderRadius: 2 },
  peakDot: { width: 3, height: 3, borderRadius: Radius.full, marginBottom: 4 },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing[2] },
  axisLabel: { fontSize: 9 },
  sinceLine: { marginTop: Spacing[4] },

  statRow: { flexDirection: 'row', alignItems: 'center' },
  statPair: { flex: 1, alignItems: 'center', gap: 2 },
  statDivider: { width: 1, height: 34 },
  firstFollow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    marginTop: Spacing[5],
    paddingTop: Spacing[4],
    borderTopWidth: 1,
  },
  firstFollowText: { flex: 1 },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[4],
    marginTop: Spacing[4],
    paddingTop: Spacing[4],
    borderTopWidth: 1,
  },
  friend: { alignItems: 'center', gap: 3 },
});
