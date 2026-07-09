import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Image as ImageIcon, Link2, PenLine } from 'lucide-react-native';
import { AccentList, Radius, Spacing, accentFor, hourAccent } from '@/constants/theme';
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
  formatHourCompact,
  heroNoun,
  longestStreakLine,
  milestoneBadge,
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

const EMPTY_ARCS: WrappedArcs = { hours: [], days: [], weeks: [], months: [] };

/** Roughly the middle of the hero card, measured from the top of the section. */
const HERO_BURST_TOP = 140;

function clampWorklet(v: number, min: number, max: number): number {
  'worklet';
  return v < min ? min : v > max ? max : v;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

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

/** Eased 0→1 once `active` flips, for drawing things on as they scroll in. */
function useDrawIn(active: boolean, duration = 650): number {
  const [p, setP] = useState(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      setP(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, duration]);

  return p;
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
  /** Stable across refetches. The label is not: it varies with the total. */
  id: string;
  value: number;
  label: string;
}

/** A wax-seal stamp for the last milestone cleared. Tap it for more confetti. */
function MilestoneStamp({
  label,
  accent,
  onPress,
}: {
  label: string;
  accent: string;
  onPress: () => void;
}) {
  const scale = useSharedValue(0);

  useEffect(() => {
    scale.value = withDelay(420, withSpring(1, { damping: 9, stiffness: 140 }));
  }, [scale]);

  const anim = useAnimatedStyle(() => ({
    opacity: scale.value,
    transform: [{ scale: scale.value }, { rotate: '-5deg' }],
  }));

  return (
    <Animated.View style={[styles.stampWrap, anim]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label} saves. Tap to celebrate.`}
        hitSlop={8}
        style={[styles.stamp, { borderColor: accent }]}
      >
        <Text variant="monoSmall" style={{ color: accent, fontSize: 10 }}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function StatPage({
  stat,
  width,
  active,
  children,
}: {
  stat: HeroStat;
  width: number;
  active: boolean;
  children?: React.ReactNode;
}) {
  const count = useCountUp(stat.value, active);

  return (
    <View style={[styles.statPage, { width }]}>
      <Text variant="hero" style={styles.heroNumber}>
        {count}
      </Text>
      <Text variant="mono" color="muted">
        {stat.label}
      </Text>
      {children}
    </View>
  );
}

function Hero({
  w,
  accent,
  active,
  onBurst,
}: {
  w: WrappedStats;
  accent: string;
  active: boolean;
  onBurst: () => void;
}) {
  const stats = useMemo<HeroStat[]>(() => {
    const all: HeroStat[] = [
      { id: 'captures', value: w.totalCaptures, label: heroNoun(w.totalCaptures) },
    ];
    if (w.distinctTopics > 0) {
      all.push({ id: 'topics', value: w.distinctTopics, label: 'topics in orbit' });
    }
    if (w.daysSinceFirst > 0) {
      all.push({ id: 'days', value: w.daysSinceFirst, label: 'days since day one' });
    }
    if (w.longestStreak >= 2) {
      all.push({ id: 'streak', value: w.longestStreak, label: 'day best streak' });
    }
    return all;
  }, [w.totalCaptures, w.distinctTopics, w.daysSinceFirst, w.longestStreak]);

  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const badge = milestoneBadge(w.totalCaptures);

  // A refetch can drop a stat (a streak lapses), leaving `page` past the end.
  const safePage = Math.min(page, stats.length - 1);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const onSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width === 0) return;
    const next = clamp(Math.round(e.nativeEvent.contentOffset.x / width), 0, stats.length - 1);
    if (next === safePage) return;
    void Haptics.selectionAsync();
    setPage(next);
    // Coming back round to the headline number earns another burst.
    if (next === 0) onBurst();
  };

  const goTo = (i: number) => {
    scroller.current?.scrollTo({ x: i * width, animated: true });
  };

  return (
    <View style={styles.heroInner} onLayout={onLayout}>
      {width > 0 ? (
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onSettle}
          style={{ width }}
        >
          {stats.map((stat, i) => (
            <StatPage key={stat.id} stat={stat} width={width} active={active && safePage === i}>
              {i === 0 ? (
                <Text variant="serif" color="secondary" style={styles.heroBody}>
                  {milestoneLine(w.totalCaptures)}
                </Text>
              ) : null}
            </StatPage>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.statPage} />
      )}

      {stats.length > 1 ? <Dots total={stats.length} active={safePage} onPress={goTo} /> : null}

      {badge && safePage === 0 ? (
        <MilestoneStamp label={badge} accent={accent} onPress={onBurst} />
      ) : null}
    </View>
  );
}

function Dots({
  total,
  active,
  onPress,
}: {
  total: number;
  active: number;
  onPress: (i: number) => void;
}) {
  const c = useThemeColors();
  return (
    <View style={styles.dotRow}>
      {Array.from({ length: total }, (_, i) => (
        <Pressable
          key={i}
          onPress={() => onPress(i)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Go to stat ${i + 1} of ${total}`}
        >
          <View style={[styles.dot, { backgroundColor: c.text, opacity: i === active ? 0.85 : 0.2 }]} />
        </Pressable>
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
            style={{ flex: it.count, backgroundColor: AccentList[i % AccentList.length] }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {items.map((it, i) => (
          <View key={it.name} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: AccentList[i % AccentList.length] }]} />
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
function TopicMass({ items, accent }: { items: { name: string; count: number }[]; accent: string }) {
  const c = useThemeColors();
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
              color: i === 0 ? accent : c.text,
              opacity: i === 0 ? 1 : 0.9 - Math.min(i, 4) * 0.13,
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

/** New topics strung along a rail, in the order you first wandered into them. */
function DiscoveryRail({ items, accent }: { items: string[]; accent: string }) {
  return (
    <View style={styles.rail}>
      {items.map((name, i) => (
        <View key={name} style={styles.railRow}>
          <View style={styles.railGutter}>
            <View style={[styles.railLine, { backgroundColor: accent, opacity: i === 0 ? 0 : 0.3 }]} />
            <View style={[styles.railDot, { backgroundColor: accent }]} />
            <View
              style={[
                styles.railLine,
                { backgroundColor: accent, opacity: i === items.length - 1 ? 0 : 0.3 },
              ]}
            />
          </View>
          <Text variant="serif" style={styles.railName} numberOfLines={1}>
            {name}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ---------------------------------------------------------------- rhythm --- */

const DIAL = 168;
const DIAL_R = 42;
const DIAL_MAX_SPOKE = 26;
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * A 24-hour clock. Midnight sits at the top and noon at the bottom; each spoke
 * is one hour of the day, drawn longer the more you saved during it, and tinted
 * by whether that hour is night, morning, afternoon, or evening.
 */
function ClockFace({
  hours,
  weekdays,
  peakHour,
  active,
}: {
  hours: number[];
  weekdays: number[];
  peakHour: number;
  active: boolean;
}) {
  const c = useThemeColors();
  // Kept local: this ticks at 60fps, and the whole section would re-render with it.
  const progress = useDrawIn(active);
  const maxHour = Math.max(1, ...hours);
  const maxDay = Math.max(1, ...weekdays);
  const peakDay = weekdays.indexOf(maxDay);
  const peakAccent = hourAccent(peakHour);
  const center = DIAL / 2;

  return (
    <View style={styles.rhythmWrap}>
      <View style={styles.dialWrap}>
        <Svg width={DIAL} height={DIAL}>
          <Circle
            cx={center}
            cy={center}
            r={DIAL_R - 10}
            stroke={c.border}
            strokeWidth={1}
            fill="none"
          />
          {hours.map((count, hour) => {
            const angle = ((hour / 24) * 360 - 90) * (Math.PI / 180);
            const len = (4 + (count / maxHour) * DIAL_MAX_SPOKE) * progress;
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
                  stroke={count === 0 ? c.border : hourAccent(hour)}
                  strokeWidth={isPeak ? 3.5 : 2}
                  strokeLinecap="round"
                  opacity={count === 0 ? 1 : isPeak ? 1 : 0.45 + (count / maxHour) * 0.35}
                />
                {isPeak && progress > 0.9 ? <Circle cx={x2} cy={y2} r={3.5} fill={peakAccent} /> : null}
              </React.Fragment>
            );
          })}
        </Svg>

        <View style={styles.dialCenter} pointerEvents="none">
          <Text variant="h4" style={{ color: peakAccent }}>
            {formatHourCompact(peakHour)}
          </Text>
          <Text variant="monoSmall" color="faint" style={styles.dialTinyLabel}>
            your hour
          </Text>
        </View>

        <Text variant="monoSmall" color="faint" style={[styles.dialTick, styles.tickTop]}>
          12a
        </Text>
        <Text variant="monoSmall" color="faint" style={[styles.dialTick, styles.tickRight]}>
          6a
        </Text>
        <Text variant="monoSmall" color="faint" style={[styles.dialTick, styles.tickBottom]}>
          12p
        </Text>
        <Text variant="monoSmall" color="faint" style={[styles.dialTick, styles.tickLeft]}>
          6p
        </Text>
      </View>

      <Text variant="monoSmall" color="faint" style={styles.dialCaption}>
        longer spoke = more saved
      </Text>

      <View style={styles.weekRow}>
        {weekdays.map((count, i) => (
          <View key={i} style={styles.weekCol}>
            <View
              style={[
                styles.weekBar,
                {
                  height: (3 + (count / maxDay) * 26) * progress,
                  backgroundColor: i === peakDay ? peakAccent : c.text,
                  opacity: i === peakDay ? 1 : 0.2,
                },
              ]}
            />
            <Text
              variant="monoSmall"
              style={{ color: i === peakDay ? peakAccent : c.faint, fontSize: 9 }}
            >
              {WEEKDAY_INITIALS[i]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- streak --- */

function StreakStrip({
  days,
  currentStreak,
  accent,
  active,
}: {
  days: ArcBucket[];
  currentStreak: number;
  accent: string;
  active: boolean;
}) {
  const c = useThemeColors();
  const progress = useDrawIn(active, 900);
  const max = Math.max(1, ...days.map((d) => d.count));
  const liveFrom = days.length - currentStreak;
  const lead = progress * (days.length + 6);

  return (
    <View style={styles.streakStrip}>
      {days.map((d, i) => {
        const live = currentStreak > 0 && i >= liveFrom;
        const pop = clamp((lead - i) / 6, 0, 1);
        return (
          <View
            key={i}
            style={[
              styles.streakDot,
              { transform: [{ scale: pop }] },
              d.count > 0
                ? {
                    backgroundColor: live ? accent : c.text,
                    opacity: live ? 1 : 0.3 + (d.count / max) * 0.35,
                  }
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

function Bar({
  height,
  delay,
  color,
  opacity,
}: {
  height: number;
  delay: number;
  color: string;
  opacity: number;
}) {
  const h = useSharedValue(2);

  useEffect(() => {
    h.value = withDelay(delay, withTiming(height, { duration: 420 }));
  }, [delay, h, height]);

  const anim = useAnimatedStyle(() => ({ height: h.value }));

  return <Animated.View style={[styles.bar, { backgroundColor: color, opacity }, anim]} />;
}

function Timeline({
  arcs,
  daysSinceFirst,
  seed,
  accent,
}: {
  arcs: WrappedArcs;
  daysSinceFirst: number;
  seed: number;
  accent: string;
}) {
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
              // The accents are mid-tone, so an 11px label on one lands under
              // 4.5:1 either way. The selected pill stays monochrome.
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
                {i === peak ? <View style={[styles.peakDot, { backgroundColor: accent }]} /> : null}
                <Bar
                  height={2 + (b.count / max) * 58}
                  delay={i * 14}
                  color={b.count === 0 ? c.border : accent}
                  opacity={b.count === 0 ? 1 : i === peak ? 1 : 0.45}
                />
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

function Social({ w, seed, accent }: { w: WrappedStats; seed: number; accent: string }) {
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
          <Avatar uri={w.firstFollow.avatarUrl} displayName={w.firstFollow.displayName} size="sm" />
          <View style={styles.firstFollowText}>
            <Text variant="serif" numberOfLines={1}>
              {w.firstFollow.displayName}
            </Text>
            <Text variant="monoSmall" style={{ color: accent, fontSize: 10 }}>
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
                <Text variant="monoSmall" style={{ color: accent, fontSize: 9 }}>
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
  const { height: screenH } = useWindowDimensions();
  const sectionY = useSharedValue(0);

  const [heroActive, setHeroActive] = useState(false);
  const [dialActive, setDialActive] = useState(false);
  const [streakActive, setStreakActive] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);

  if (!stats) return null;
  const w = stats;
  const arcs = w.arcs ?? EMPTY_ARCS;
  const seed = w.totalCaptures * 31 + w.distinctTopics;
  const accent = accentFor(seed);

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
  const hasRhythm =
    w.busiestHour !== null && w.busiestDayOfWeek !== null && w.hourHistogram?.length === 24;

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
          <Hero w={w} accent={accent} active={heroActive} onBurst={burst} />
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
          <TopicMass items={w.topTopics} accent={accent} />
        </RevealCard>
      ) : null}

      {w.newTopicsThisMonth.length > 0 ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            {newTopicsTitle(seed)}
          </Text>
          <DiscoveryRail items={w.newTopicsThisMonth.slice(0, 6)} accent={accent} />
        </RevealCard>
      ) : null}

      {hasRhythm ? (
        <RevealCard {...cardProps} onReveal={() => setDialActive(true)}>
          <Text variant="serif" style={styles.cardTitle}>
            {rhythmLine(w.busiestHour!, w.busiestDayOfWeek!)}
          </Text>
          <ClockFace
            hours={w.hourHistogram}
            weekdays={w.weekdayHistogram}
            peakHour={w.busiestHour!}
            active={dialActive}
          />
        </RevealCard>
      ) : null}

      {w.longestStreak >= 2 ? (
        <RevealCard {...cardProps} onReveal={() => setStreakActive(true)}>
          <View style={styles.streakHead}>
            <Text variant="hero" style={[styles.streakNumber, { color: accent }]}>
              {w.longestStreak}
            </Text>
            <Text variant="serif" color="secondary" style={styles.streakLine}>
              {longestStreakLine(w.longestStreak)}
            </Text>
          </View>
          {arcs.days.length > 0 ? (
            <StreakStrip
              days={arcs.days}
              currentStreak={w.currentStreak}
              accent={accent}
              active={streakActive}
            />
          ) : null}
          {w.currentStreak >= 2 ? (
            <Text variant="monoSmall" color="faint" style={styles.currentStreak}>
              {currentStreakLine(w.currentStreak)}
            </Text>
          ) : null}
        </RevealCard>
      ) : null}

      {archetype ? (
        <RevealCard {...cardProps}>
          <View style={styles.archetypeRow}>
            <View style={[styles.glyph, { borderColor: accent }]}>
              {React.createElement(ARCHETYPE_ICONS[archetype.format], {
                size: 24,
                color: accent,
                strokeWidth: 1.5,
              })}
            </View>
            <View style={styles.archetypeText}>
              <Text variant="monoSmall" color="faint">
                your type
              </Text>
              <Text variant="h3">{archetype.name}</Text>
              <Text variant="serif" color="secondary" style={styles.archetypeLine}>
                {archetype.line}
              </Text>
            </View>
          </View>
        </RevealCard>
      ) : null}

      {w.totalCaptures > 0 && arcs.months.length > 0 ? (
        <RevealCard {...cardProps}>
          <Timeline arcs={arcs} daysSinceFirst={w.daysSinceFirst} seed={seed} accent={accent} />
          {w.firstCaptureAt ? (
            <Text variant="monoSmall" color="faint" style={styles.sinceLine}>
              {sinceLine(w.firstCaptureAt, w.totalCaptures)}
            </Text>
          ) : null}
        </RevealCard>
      ) : null}

      <RevealCard {...cardProps}>
        <Social w={w} seed={seed} accent={accent} />
      </RevealCard>

      {/* Painted last and lifted above every card, so a burst is never trapped behind one. */}
      <View style={styles.confettiLayer} pointerEvents="none">
        {confettiKey > 0 ? <Confetti trigger={confettiKey} originTop={HERO_BURST_TOP} /> : null}
      </View>
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
  confettiLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    elevation: 50,
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
    paddingVertical: Spacing[6],
    minHeight: 210,
    justifyContent: 'center',
  },
  heroInner: { alignSelf: 'stretch', alignItems: 'center' },
  statPage: { alignItems: 'center', justifyContent: 'center', minHeight: 160 },
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
    maxWidth: 280,
  },
  dotRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: Spacing[4],
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: Radius.full,
  },
  stampWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  stamp: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: 3,
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

  rail: { marginTop: Spacing[4] },
  railRow: { flexDirection: 'row', alignItems: 'stretch', minHeight: 34 },
  railGutter: { width: 16, alignItems: 'center' },
  railLine: { width: 1, flex: 1 },
  railDot: { width: 7, height: 7, borderRadius: Radius.full },
  railName: { flex: 1, marginLeft: Spacing[3], alignSelf: 'center' },

  rhythmWrap: { alignItems: 'center', marginTop: Spacing[4] },
  dialWrap: { width: DIAL, height: DIAL, alignItems: 'center', justifyContent: 'center' },
  dialCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  dialTinyLabel: { fontSize: 9, marginTop: 2 },
  dialTick: { position: 'absolute', fontSize: 9 },
  tickTop: { top: 0, left: 0, right: 0, textAlign: 'center' },
  tickBottom: { bottom: 0, left: 0, right: 0, textAlign: 'center' },
  tickLeft: { left: 0, top: DIAL / 2 - 6 },
  tickRight: { right: 0, top: DIAL / 2 - 6 },
  dialCaption: { marginTop: Spacing[4], fontSize: 9 },
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
  currentStreak: { marginTop: Spacing[3] },

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
  archetypeLine: { marginTop: Spacing[1] },

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
