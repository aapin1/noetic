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
  useFrameCallback,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
// expo-router v57 dropped @react-navigation/* (now standard-navigation) and
// re-exports the navigation hooks directly.
import { useRouter, useIsFocused } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronRight, Image as ImageIcon, Link2, PenLine } from 'lucide-react-native';
import { AccentList, Radius, Spacing, accentFor, hourAccent } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
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
  timelineTitle,
  topicsKicker,
} from './copy';
import type { ArchetypeFormat } from './copy';
import type { ArcBucket, TerrainResponse, WrappedArcs, WrappedStats } from '@/types/api';

// The wrapped stack fills in as you log, rather than showing every card from
// capture one. A card appears only when BOTH its data guard and its capture-count
// gate pass. Kept ≤ 10 so the page feels alive within the first week; the hero
// and social cards have no gate (you can always follow someone).
const GATE_FIELDS = 3;
const GATE_TOPICS = 3;
const GATE_NEW_TOPICS = 5;
const GATE_RHYTHM = 5;
const GATE_ARCHETYPE = 5;
const GATE_TIMELINE = 7;
/** The flagship "terrain" self-portrait needs real history behind it. */
const GATE_TERRAIN = 50;

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
      <View style={[styles.spectrumBar, { backgroundColor: c.surface }]}>
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

const BUBBLE_BOX_H = 224;
const MAX_BUBBLES = 4;
const MIN_BUBBLE_R = 24;
const MAX_BUBBLE_R = 54;
/** A label too long for its rank-assigned bubble grows the bubble up to here. */
const HARD_MAX_BUBBLE_R = 58;

/** Horizontal padding inside a bubble — must match `styles.bubble`. */
const BUBBLE_PAD_H = 5;
/**
 * Mean glyph advance of the serif (Times) as a fraction of font size. Rounded
 * generously upward: over-measuring only shrinks the font, whereas
 * under-measuring lets a line overflow and get wrapped or ellipsized by RN,
 * which is the failure we are ruling out.
 */
const GLYPH_W = 0.58;
const BUBBLE_LINE_H = 1.15;
const BUBBLE_FS_MAX = 14;
const BUBBLE_FS_MIN = 8;
const BUBBLE_MAX_LINES = 3;
/** Keep the corners of the text block this far inside the circle. */
const TEXT_INSET = 6;

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /**
   * Squish factors, driven as a damped spring toward 1. An impact kicks the
   * spring's velocity rather than setting the scale outright, so the bubble
   * wobbles past its rest shape and settles — setting the scale directly is
   * what made the old impacts read as a rigid shockwave.
   */
  sx: number;
  sy: number;
  sxv: number;
  syv: number;
}

/**
 * Break `words` across at most BUBBLE_MAX_LINES lines — never splitting a word —
 * and return the split whose text block fits in the smallest circle. Labels are
 * a handful of words, so every contiguous split is cheap to just enumerate.
 */
function layoutLabelAt(words: string[], fs: number): { lines: string[]; requiredR: number } {
  const n = words.length;
  const lineW = (s: string) => s.length * GLYPH_W * fs;

  const cutSets: number[][] = [[]];
  for (let a = 1; a < n; a += 1) {
    cutSets.push([a]);
    for (let b = a + 1; b < n; b += 1) cutSets.push([a, b]);
  }

  let best: { lines: string[]; requiredR: number } | null = null;
  for (const cuts of cutSets) {
    if (cuts.length + 1 > BUBBLE_MAX_LINES) continue;
    const bounds = [0, ...cuts, n];
    const lines: string[] = [];
    for (let i = 0; i < bounds.length - 1; i += 1) {
      lines.push(words.slice(bounds[i], bounds[i + 1]).join(' '));
    }
    const blockW = Math.max(...lines.map(lineW));
    const blockH = lines.length * fs * BUBBLE_LINE_H;
    // The text block is a rectangle centred in the circle, so it fits exactly
    // when its corners do — hence the half-diagonal, not the half-width.
    const requiredR = Math.hypot(blockW / 2, blockH / 2) + TEXT_INSET;
    if (!best || requiredR < best.requiredR) best = { lines, requiredR };
  }
  return best ?? { lines: [words.join(' ')], requiredR: MIN_BUBBLE_R };
}

/**
 * Fit a topic name inside its bubble. Picks the largest font at which the label
 * wraps cleanly on word boundaries and still sits inside the circle; if the
 * label cannot be read at any usable size in its rank-assigned bubble, the
 * bubble grows rather than the word being clipped or split.
 */
function fitLabel(label: string, rankR: number): { r: number; fontSize: number; lines: string[] } {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { r: rankR, fontSize: BUBBLE_FS_MIN, lines: [label] };

  let r = rankR;
  let fontSize = BUBBLE_FS_MIN;
  let lines = [label];

  let fitted = false;
  for (let fs = BUBBLE_FS_MAX; fs >= BUBBLE_FS_MIN; fs -= 0.5) {
    const fit = layoutLabelAt(words, fs);
    lines = fit.lines;
    fontSize = fs;
    if (fit.requiredR <= rankR) {
      fitted = true;
      break;
    }
  }
  if (!fitted) r = Math.min(layoutLabelAt(words, BUBBLE_FS_MIN).requiredR, HARD_MAX_BUBBLE_R);

  // Hard guarantee against a mid-word break: the longest word must fit on one
  // line of the bubble's inner width, whatever the geometry above concluded.
  const longest = Math.max(...words.map((word) => word.length));
  const inner = 2 * r - 2 * BUBBLE_PAD_H;
  fontSize = Math.min(fontSize, inner / (longest * GLYPH_W));

  return { r, fontSize, lines };
}

/** Small deterministic PRNG so a bubble field lays out the same for the same stats. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One bubble. Size is fixed; only position and squish are driven per frame. */
function Bubble({
  index,
  bodies,
  radius,
  lines,
  fill,
  border,
  textColor,
  fontSize,
}: {
  index: number;
  bodies: SharedValue<Body[]>;
  radius: number;
  lines: string[];
  fill: string;
  border: string;
  textColor: string;
  fontSize: number;
}) {
  const anim = useAnimatedStyle(() => {
    const b = bodies.value[index];
    if (!b) return { opacity: 0 };
    return {
      opacity: 1,
      transform: [
        { translateX: b.x - radius },
        { translateY: b.y - radius },
        { scaleX: b.sx },
        { scaleY: b.sy },
      ],
    };
  });

  // Undo the bubble's squish on the label. The skin deforms; the word does not.
  const textAnim = useAnimatedStyle(() => {
    const b = bodies.value[index];
    if (!b) return {};
    return { transform: [{ scaleX: 1 / b.sx }, { scaleY: 1 / b.sy }] };
  });

  return (
    <Animated.View
      style={[
        styles.bubble,
        { width: radius * 2, height: radius * 2, borderRadius: radius, backgroundColor: fill, borderColor: border },
        anim,
      ]}
    >
      <Animated.View style={textAnim}>
        <Text
          variant="serif"
          numberOfLines={lines.length}
          style={{
            color: textColor,
            fontSize,
            lineHeight: fontSize * BUBBLE_LINE_H,
            textAlign: 'center',
          }}
        >
          {lines.join('\n')}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Top topics as squishy bubbles that drift, collide, and bounce off each other
 * and the walls. The physics runs entirely on the UI thread and only while the
 * card is on screen and the tab is focused, so it costs nothing in the background.
 */
function TopicBubbles({
  items,
  accent,
  seed,
  active,
}: {
  items: { name: string; count: number }[];
  accent: string;
  seed: number;
  active: boolean;
}) {
  const c = useThemeColors();
  const isFocused = useIsFocused();
  const data = useMemo(() => items.slice(0, MAX_BUBBLES), [items]);
  const [w, setW] = useState(0);

  const bw = useSharedValue(0);
  const bh = useSharedValue(BUBBLE_BOX_H);
  const bodies = useSharedValue<Body[]>([]);

  // Rank-based radius: items arrive sorted by prominence (`top: i === 0` already
  // assumes that), so size steps down clearly and monotonically by rank —
  // biggest, then visibly smaller, smaller again, smallest — rather than by
  // raw frequency, which could leave close counts looking near-identical.
  const layout = useMemo(() => {
    const maxR = clamp((w || 320) / 4.4, MIN_BUBBLE_R + 14, MAX_BUBBLE_R);
    const steps = Math.max(1, data.length - 1);
    return data.map((d, i) => {
      const rankR = data.length === 1 ? maxR : maxR - (i / steps) * (maxR - MIN_BUBBLE_R);
      // Rank proposes the size; the label can veto it. Legibility outranks the
      // size hierarchy, and the top bubble still reads as top via its fill.
      const fit = fitLabel(d.name, rankR);
      return { ...fit, top: i === 0 };
    });
  }, [data, w]);

  // Seed positions and gentle velocities once the box is measured. Bubbles
  // are placed one per quadrant (2x2 for up to 4) so they never start
  // overlapping — an overlapping start was the actual cause of the
  // "shockwave": the solver spent its first several frames violently
  // separating bubbles that were dropped on top of each other at random.
  useEffect(() => {
    if (w === 0 || layout.length === 0) return;
    bw.value = w;
    bh.value = BUBBLE_BOX_H;
    const rng = makeRng(seed + data.length * 97);
    const cols = layout.length > 1 ? 2 : 1;
    const rows = Math.ceil(layout.length / cols);
    const qw = w / cols;
    const qh = BUBBLE_BOX_H / rows;
    bodies.value = layout.map((L, i) => {
      const r = L.r;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = col * qw + qw / 2;
      const cy = row * qh + qh / 2;
      const jitterX = Math.max(0, qw / 2 - r - 4);
      const jitterY = Math.max(0, qh / 2 - r - 4);
      const x = clamp(cx + (rng() * 2 - 1) * jitterX, r, Math.max(r, w - r));
      const y = clamp(cy + (rng() * 2 - 1) * jitterY, r, Math.max(r, BUBBLE_BOX_H - r));
      const ang = rng() * Math.PI * 2;
      const sp = 0.35 + rng() * 0.35;
      return { x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r, sx: 1, sy: 1, sxv: 0, syv: 0 };
    });
  }, [w, layout, seed, data.length, bodies, bw, bh]);

  const frame = useFrameCallback((info) => {
    'worklet';
    const bs = bodies.value;
    const n = bs.length;
    if (n === 0) return;
    const W = bw.value;
    const H = bh.value;
    const dt = Math.min(40, info.timeSincePreviousFrame ?? 16) / 16;
    // A bubble should bounce, not rub. Restitution is high so a hit actually
    // reverses the bubbles apart, and the overlap is corrected in essentially
    // one frame so they never interpenetrate and grind along each other's
    // edge — that grinding, plus a near-total loss of speed on contact, was
    // what made the old field feel like it was made of rubber bricks.
    const REST = 0.88;
    const CORRECTION = 0.9;
    // An impact kicks the squish spring's *velocity*; the spring (stiffness K,
    // damping D < 1) then carries the shape past its rest state and wobbles it
    // back. The old code assigned the scale directly and eased it back
    // linearly, which is a step function — the "rigid shockwave".
    const SQUISH_K = 0.16;
    const SQUISH_D = 0.88;
    const IMPACT = 0.05;
    const IMPACT_MAX = 0.09;
    const SQUISH_MIN = 0.78;
    const SQUISH_MAX = 1.22;
    const MIN_SPEED = 0.22;
    const MAX_SPEED = 1.5;

    for (let i = 0; i < n; i += 1) {
      const b = bs[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x - b.r < 0 || b.x + b.r > W) {
        const kick = clampWorklet(Math.abs(b.vx) * IMPACT, 0, IMPACT_MAX);
        if (b.x - b.r < 0) {
          b.x = b.r;
          b.vx = Math.abs(b.vx) * REST;
        } else {
          b.x = W - b.r;
          b.vx = -Math.abs(b.vx) * REST;
        }
        b.sxv -= kick;
        b.syv += kick;
      }
      if (b.y - b.r < 0 || b.y + b.r > H) {
        const kick = clampWorklet(Math.abs(b.vy) * IMPACT, 0, IMPACT_MAX);
        if (b.y - b.r < 0) {
          b.y = b.r;
          b.vy = Math.abs(b.vy) * REST;
        } else {
          b.y = H - b.r;
          b.vy = -Math.abs(b.vy) * REST;
        }
        b.syv -= kick;
        b.sxv += kick;
      }
    }

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = bs[i];
        const b = bs[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.r + b.r;
        if (dist > 0 && dist < minDist) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = ((minDist - dist) / 2) * CORRECTION;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;

          const avn = a.vx * nx + a.vy * ny;
          const bvn = b.vx * nx + b.vy * ny;
          // Only respond while they are closing. Without this the pair keeps
          // re-colliding on the frames it takes to separate and sticks.
          const closing = bvn - avn;
          if (closing < 0) {
            // Equal masses: swap the normal components, scaled by restitution.
            const jimp = ((1 + REST) * closing) / 2;
            a.vx += jimp * nx;
            a.vy += jimp * ny;
            b.vx -= jimp * nx;
            b.vy -= jimp * ny;

            const kick = clampWorklet(-closing * IMPACT, 0, IMPACT_MAX);
            const alongX = Math.abs(nx) > Math.abs(ny);
            a.sxv += alongX ? -kick : kick;
            a.syv += alongX ? kick : -kick;
            b.sxv += alongX ? -kick : kick;
            b.syv += alongX ? kick : -kick;
          }
        }
      }
    }

    for (let i = 0; i < n; i += 1) {
      const b = bs[i];
      b.sxv = (b.sxv + (1 - b.sx) * SQUISH_K) * SQUISH_D;
      b.syv = (b.syv + (1 - b.sy) * SQUISH_K) * SQUISH_D;
      b.sx = clampWorklet(b.sx + b.sxv * dt, SQUISH_MIN, SQUISH_MAX);
      b.sy = clampWorklet(b.sy + b.syv * dt, SQUISH_MIN, SQUISH_MAX);

      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp < MIN_SPEED) {
        if (sp < 0.0001) {
          b.vx = MIN_SPEED;
        } else {
          const k = MIN_SPEED / sp;
          b.vx *= k;
          b.vy *= k;
        }
      } else if (sp > MAX_SPEED) {
        const k = MAX_SPEED / sp;
        b.vx *= k;
        b.vy *= k;
      }
    }

    // Reassign to a new array reference — Reanimated's setter no-ops when the
    // incoming value is === the current one, and `bs` here still IS
    // `bodies.value` (mutated in place above), so without the copy every
    // Bubble's useAnimatedStyle would silently stop re-running.
    bodies.value = bs.slice();
  }, false);

  useEffect(() => {
    frame.setActive(active && isFocused && w > 0);
  }, [active, isFocused, w, frame]);

  return (
    <View style={styles.bubbleBox} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {layout.map((L, i) => (
        <Bubble
          key={data[i].name}
          index={i}
          bodies={bodies}
          radius={L.r}
          lines={L.lines}
          fill={L.top ? accent : c.elevated}
          border={L.top ? accent : c.border}
          textColor={L.top ? '#fff' : c.text}
          fontSize={L.fontSize}
        />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------ new topics --- */

/**
 * A chevron that stays fully visible until the user starts scrolling the
 * rail, then fades out in step with scroll progress and is gone once they
 * reach the end. Tapping it scrolls straight to the end.
 */
function ScrollRightHint({
  accent,
  progress,
  onPress,
}: {
  accent: string;
  progress: SharedValue<number>;
  onPress: () => void;
}) {
  const c = useThemeColors();
  const anim = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  return (
    <Animated.View style={[styles.tlHint, { backgroundColor: c.surface, borderColor: accent }, anim]}>
      <Pressable
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Scroll to see more topics"
        style={styles.tlHintPress}
      >
        <ChevronRight size={12} color={accent} strokeWidth={2.5} />
      </Pressable>
    </Animated.View>
  );
}

/**
 * New topics as a horizontal timeline, left to right in the order you first
 * wandered into them. The last node — the most recent — is filled; the rail
 * scrolls sideways if there are more than fit, and an arrow — tappable to
 * jump to the end — fades out as the user scrolls toward it.
 */
function DiscoveryTimeline({ items, accent }: { items: string[]; accent: string }) {
  const c = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const containerW = useRef(0);
  const contentW = useRef(0);
  const progress = useSharedValue(0);

  const updateProgress = (offsetX: number) => {
    const overflow = contentW.current - containerW.current;
    if (overflow <= 4) {
      setCanScrollRight(false);
      return;
    }
    const p = clamp(offsetX / overflow, 0, 1);
    progress.value = p;
    setCanScrollRight(p < 0.98);
  };

  const scrollToEnd = () => {
    scrollRef.current?.scrollTo({
      x: Math.max(0, contentW.current - containerW.current),
      animated: true,
    });
  };

  return (
    <View style={styles.tlWrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tlTrack}
        scrollEventThrottle={16}
        onLayout={(e) => {
          containerW.current = e.nativeEvent.layout.width;
          updateProgress(0);
        }}
        onContentSizeChange={(w) => {
          contentW.current = w;
          updateProgress(0);
        }}
        onScroll={(e) => updateProgress(e.nativeEvent.contentOffset.x)}
      >
        {items.map((name, i) => {
          const newest = i === items.length - 1;
          return (
            <View key={name} style={styles.tlNode}>
              <View style={styles.tlLineRow}>
                <View style={[styles.tlLine, { backgroundColor: accent, opacity: i === 0 ? 0 : 0.3 }]} />
                <View
                  style={[
                    styles.tlDot,
                    newest
                      ? { backgroundColor: accent }
                      : { backgroundColor: c.surface, borderWidth: 1.5, borderColor: accent },
                  ]}
                />
                <View
                  style={[styles.tlLine, { backgroundColor: accent, opacity: newest ? 0 : 0.3 }]}
                />
              </View>
              <Text variant="serif" numberOfLines={2} style={styles.tlLabel}>
                {name}
              </Text>
            </View>
          );
        })}
      </ScrollView>
      {canScrollRight ? (
        <ScrollRightHint accent={accent} progress={progress} onPress={scrollToEnd} />
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- rhythm --- */

const DIAL = 168;
const DIAL_R = 42;
const DIAL_MAX_SPOKE = 26;
/** Reserved margin around the dial so tick labels sit clear of the longest spoke. */
const DIAL_TICK_PAD = 12;
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * A 24-hour clock. Midnight sits at the top and noon at the bottom; each spoke
 * is one hour of the day, drawn longer the more you saved during it, and tinted
 * by whether that hour is night, morning, afternoon, or evening. The peak hour
 * is stated once in the card header, so the dial itself stays clean.
 */
function ClockFace({
  hours,
  peakHour,
  active,
}: {
  hours: number[];
  peakHour: number;
  active: boolean;
}) {
  const c = useThemeColors();
  // Kept local: this ticks at 60fps, and the whole section would re-render with it.
  const progress = useDrawIn(active);
  const maxHour = Math.max(1, ...hours);
  const peakAccent = hourAccent(peakHour);
  const center = DIAL / 2;

  return (
    <View style={styles.dialWrap}>
      <Svg width={DIAL} height={DIAL}>
        <Circle cx={center} cy={center} r={DIAL_R - 10} stroke={c.border} strokeWidth={1} fill="none" />
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
  );
}

/** The busiest weekday, as seven bars. Lives in the timeline card now. */
function WeekdayBars({ weekdays, accent }: { weekdays: number[]; accent: string }) {
  const c = useThemeColors();
  const maxDay = Math.max(1, ...weekdays);
  const peakDay = weekdays.indexOf(maxDay);

  return (
    <View style={styles.weekRow}>
      {weekdays.map((count, i) => (
        <View key={i} style={styles.weekCol}>
          <View
            style={[
              styles.weekBar,
              {
                height: 3 + (count / maxDay) * 26,
                backgroundColor: i === peakDay ? accent : c.text,
                opacity: i === peakDay ? 1 : 0.2,
              },
            ]}
          />
          <Text variant="monoSmall" style={{ color: i === peakDay ? accent : c.faint, fontSize: 9 }}>
            {WEEKDAY_INITIALS[i]}
          </Text>
        </View>
      ))}
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
  weekdays,
}: {
  arcs: WrappedArcs;
  daysSinceFirst: number;
  seed: number;
  accent: string;
  weekdays?: number[];
}) {
  const c = useThemeColors();
  // Follow the data-driven default until the user picks a range themselves.
  // Freezing the initial choice in state left an early user stuck on "24h" even
  // after weeks of history had accrued — the card looked like it never updated.
  const [manualRange, setManualRange] = useState<RangeKey | null>(null);
  const range = manualRange ?? defaultRange(daysSinceFirst);
  const buckets = arcs[range];
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const peak = buckets.reduce((best, b, i) => (b.count > buckets[best].count ? i : best), 0);
  const total = buckets.reduce((sum, b) => sum + b.count, 0);

  const select = (key: RangeKey) => {
    if (key === range) return;
    void Haptics.selectionAsync();
    setManualRange(key);
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

      {weekdays && weekdays.length === 7 && weekdays.some((n) => n > 0) ? (
        <View style={[styles.weekBlock, { borderTopColor: c.borderSubtle }]}>
          <Text variant="serif" style={[styles.cardTitle, styles.weekLabel]}>
            By weekday
          </Text>
          <WeekdayBars weekdays={weekdays} accent={accent} />
        </View>
      ) : null}
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

/** "Mar 2026" — enough to place a follow in time without the false precision of a day. */
function followedSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function Social({ w, seed, accent }: { w: WrappedStats; seed: number; accent: string }) {
  const c = useThemeColors();
  const router = useRouter();

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
            <Text variant="monoSmall" style={{ color: accent, fontSize: 10 }}>
              {firstFollowCaption(w.firstFollow.handle)}
            </Text>
            <Text variant="serif" numberOfLines={1}>
              {w.firstFollow.displayName}
            </Text>
            {/* The handle and the date are the point — without them this row was
                a face with no explanation of why it was being shown. */}
            <Text variant="monoSmall" color="faint" numberOfLines={1}>
              @{w.firstFollow.handle} · following since {followedSince(w.firstFollow.followedAt)}
            </Text>
          </View>
        </View>
      ) : null}

      {w.followingCount > 0 ? (
        <View style={[styles.friendBlock, { borderTopColor: c.borderSubtle }]}>
          {w.friendActivity.length === 0 ? (
            <Text variant="monoSmall" color="faint">
              {quietWeekLine(seed)}
            </Text>
          ) : (
            <>
              {/* A bare "+3" under a face never said +3 of what, or over what
                  span. Spell out both, and give the row somewhere to go. */}
              <Text variant="label" color="muted" style={styles.friendHeading}>
                busy this week
              </Text>
              {w.friendActivity.map((f) => (
                <Pressable
                  key={f.handle}
                  onPress={() => router.push('/(tabs)/pulse' as never)}
                  style={({ pressed }) => [styles.friendRow, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.displayName} captured ${f.count} ${f.count === 1 ? 'thing' : 'things'} this week. Open pulse.`}
                >
                  <Avatar uri={f.avatarUrl} displayName={f.displayName} size="sm" />
                  <View style={styles.friendText}>
                    <Text variant="serif" numberOfLines={1}>
                      {f.displayName}
                    </Text>
                    <Text variant="monoSmall" color="faint" numberOfLines={1}>
                      @{f.handle}
                    </Text>
                  </View>
                  <Text variant="monoSmall" style={{ color: accent }}>
                    {f.count} {f.count === 1 ? 'capture' : 'captures'}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => router.push('/(tabs)/pulse' as never)}
                style={({ pressed }) => [styles.friendCta, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
              >
                <Text variant="monoSmall" color="muted">see them on pulse →</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------- terrain --- */

/** The headline for the terrain card — the drift, rendered as meaning. */
function terrainHeadline(data: TerrainResponse): string {
  if (data.driftBand && data.driftBand !== 'settled' && data.towardField) {
    return `${data.driftBand} toward ${data.towardField}`;
  }
  if (data.driftBand === 'settled') return 'a mind holding its ground';
  if (data.emerged.length > 0) return `new ground: ${data.emerged[0]}`;
  return 'how your mind has moved';
}

/** Compact teaser: prefer the LLM arc, else a deterministic line about the core. */
function terrainTeaser(data: TerrainResponse): string {
  if (data.arc) return data.arc;
  if (data.enduring.length > 0) {
    return `${data.enduring[0]} has held steady while the ground around it shifted.`;
  }
  if (data.emerged.length > 0 && data.faded.length > 0) {
    return `${data.faded[0]} gave way to ${data.emerged[0]}.`;
  }
  return `${data.captureCount} captures, ${data.earlyLabel} to ${data.recentLabel}.`;
}

/** The entry point that lives in the You stack; tapping opens the full screen. */
function TerrainCardBody({ data, accent }: { data: TerrainResponse; accent: string }) {
  const c = useThemeColors();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        router.push('/terrain' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel="Open terrain — how your mind has moved over time"
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
    >
      <Text variant="serif" style={[styles.cardTitle, styles.overline]}>
        terrain
      </Text>
      <Text variant="h3" style={styles.terrainHeadline}>
        {terrainHeadline(data)}
      </Text>
      <Text variant="serif" color="secondary" numberOfLines={3} style={styles.terrainTeaser}>
        {terrainTeaser(data)}
      </Text>
      <View style={[styles.terrainFoot, { borderTopColor: c.borderSubtle }]}>
        <Text variant="monoSmall" color="faint">
          {data.captureCount} captures · {data.earlyLabel} → {data.recentLabel}
        </Text>
        <View style={styles.terrainOpen}>
          <Text variant="monoSmall" style={{ color: accent }}>
            the long view
          </Text>
          <ChevronRight size={13} color={accent} strokeWidth={2.5} />
        </View>
      </View>
    </Pressable>
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
  const [topicsActive, setTopicsActive] = useState(false);
  const [dialActive, setDialActive] = useState(false);
  const [streakActive, setStreakActive] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);

  // Only fetched once you're past the terrain gate, so the extra (embedding-
  // heavy, server-cached) endpoint never runs for lighter users.
  const { data: terrain } = useApiQuery(() => api.memory.terrain(), [], {
    cacheKey: 'memory.terrain',
    skip: (stats?.totalCaptures ?? 0) < GATE_TERRAIN,
  });

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
  // The current run has reached the all-time best, so the two are the same story.
  const streakOngoing = w.currentStreak >= 2 && w.currentStreak === w.longestStreak;

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

      {w.topFields.length > 0 && w.totalCaptures >= GATE_FIELDS ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            {fieldsTitle(seed)}
          </Text>
          <Spectrum items={w.topFields} />
        </RevealCard>
      ) : null}

      {w.topTopics.length > 0 && w.totalCaptures >= GATE_TOPICS ? (
        <RevealCard {...cardProps} onReveal={() => setTopicsActive(true)}>
          <Text variant="serif" style={[styles.cardTitle, styles.overline]}>
            {topicsKicker(seed)}
          </Text>
          <TopicBubbles items={w.topTopics} accent={accent} seed={seed} active={topicsActive} />
        </RevealCard>
      ) : null}

      {w.newTopicsThisMonth.length > 0 && w.totalCaptures >= GATE_NEW_TOPICS ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            {newTopicsTitle(seed)}
          </Text>
          <DiscoveryTimeline items={w.newTopicsThisMonth.slice(0, 6)} accent={accent} />
        </RevealCard>
      ) : null}

      {hasRhythm && w.totalCaptures >= GATE_RHYTHM ? (
        <RevealCard {...cardProps} onReveal={() => setDialActive(true)}>
          <View style={styles.rhythmHead}>
            <Text variant="h3" style={{ color: hourAccent(w.busiestHour!) }}>
              {formatHourCompact(w.busiestHour!)}
            </Text>
            <Text variant="serif" color="secondary" style={styles.rhythmHeadLine}>
              {rhythmLine(w.busiestHour!, w.busiestDayOfWeek!)}
            </Text>
          </View>
          <ClockFace hours={w.hourHistogram} peakHour={w.busiestHour!} active={dialActive} />
        </RevealCard>
      ) : null}

      {w.longestStreak >= 2 ? (
        <RevealCard {...cardProps} onReveal={() => setStreakActive(true)}>
          <View style={styles.streakHead}>
            <Text variant="hero" style={[styles.streakNumber, { color: accent }]}>
              {w.longestStreak}
            </Text>
            {/* When the current run is the record, the live framing IS the headline,
                so we never state the same count on a second line below. */}
            <Text variant="serif" color="secondary" style={styles.streakLine}>
              {streakOngoing ? currentStreakLine(w.currentStreak) : longestStreakLine(w.longestStreak)}
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
          {!streakOngoing && w.currentStreak >= 2 ? (
            <Text variant="monoSmall" color="faint" style={styles.currentStreak}>
              {currentStreakLine(w.currentStreak)}
            </Text>
          ) : null}
        </RevealCard>
      ) : null}

      {archetype && w.totalCaptures >= GATE_ARCHETYPE ? (
        <RevealCard {...cardProps}>
          <Text variant="serif" style={styles.cardTitle}>
            Your type
          </Text>
          <View style={styles.archetypeRow}>
            <View style={[styles.glyph, { borderColor: accent }]}>
              {React.createElement(ARCHETYPE_ICONS[archetype.format], {
                size: 24,
                color: accent,
                strokeWidth: 1.5,
              })}
            </View>
            <View style={styles.archetypeText}>
              <Text variant="h3">{archetype.name}</Text>
              <Text variant="serif" color="secondary" style={styles.archetypeLine}>
                {archetype.line}
              </Text>
            </View>
          </View>
        </RevealCard>
      ) : null}

      {w.totalCaptures >= GATE_TIMELINE && arcs.months.length > 0 ? (
        <RevealCard {...cardProps}>
          <Timeline
            arcs={arcs}
            daysSinceFirst={w.daysSinceFirst}
            seed={seed}
            accent={accent}
            weekdays={hasRhythm ? w.weekdayHistogram : undefined}
          />
        </RevealCard>
      ) : null}

      {w.totalCaptures >= GATE_TERRAIN && terrain?.unlocked ? (
        <RevealCard {...cardProps}>
          <TerrainCardBody data={terrain} accent={accent} />
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
    ...StyleSheet.absoluteFill,
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

  bubbleBox: {
    height: BUBBLE_BOX_H,
    marginTop: Spacing[4],
    overflow: 'hidden',
  },
  bubble: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 5,
  },

  tlWrap: { position: 'relative' },
  tlTrack: { marginTop: Spacing[5], paddingBottom: Spacing[1] },
  tlNode: { width: 96, alignItems: 'center' },
  tlLineRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  tlLine: { flex: 1, height: 1.5 },
  tlDot: { width: 9, height: 9, borderRadius: Radius.full },
  tlLabel: { marginTop: Spacing[3], textAlign: 'center', fontSize: 13, lineHeight: 17 },
  tlHint: {
    position: 'absolute',
    right: -4,
    // tlTrack's marginTop (Spacing[5]) puts the dot row's vertical center at
    // Spacing[5] + tlDot height / 2; centered here so the hint lines up with
    // the dots and lines instead of hanging down toward the labels.
    top: Spacing[5] - 5.5,
    width: 20,
    height: 20,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tlHintPress: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },

  rhythmHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing[4] },
  rhythmHeadLine: { flex: 1, lineHeight: 24 },
  dialWrap: {
    width: DIAL + DIAL_TICK_PAD * 2,
    height: DIAL + DIAL_TICK_PAD * 2,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing[5],
  },
  // Pinned to the outer edge of the padded wrap — entirely outside the SVG's
  // bounding box — so a label can never overlap a spoke no matter how long it is.
  dialTick: { position: 'absolute', fontSize: 11 },
  tickTop: { top: 0, left: 0, right: 0, textAlign: 'center' },
  tickBottom: { bottom: 0, left: 0, right: 0, textAlign: 'center' },
  tickLeft: { left: 0, top: (DIAL + DIAL_TICK_PAD * 2) / 2 - 6 },
  tickRight: { right: 0, top: (DIAL + DIAL_TICK_PAD * 2) / 2 - 6 },
  weekBlock: { marginTop: Spacing[5], paddingTop: Spacing[4], borderTopWidth: 1 },
  weekLabel: { marginBottom: Spacing[3] },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    alignSelf: 'stretch',
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

  archetypeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[5], marginTop: Spacing[4] },
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
  firstFollowText: { flex: 1, gap: 2 },
  friendBlock: {
    marginTop: Spacing[4],
    paddingTop: Spacing[4],
    borderTopWidth: 1,
  },
  friendHeading: { marginBottom: Spacing[3] },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[2],
  },
  friendText: { flex: 1, gap: 2 },
  friendCta: { marginTop: Spacing[2], alignSelf: 'flex-end' },

  terrainHeadline: { marginBottom: Spacing[2] },
  terrainTeaser: { lineHeight: 22 },
  terrainFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[4],
    paddingTop: Spacing[3],
    borderTopWidth: 1,
  },
  terrainOpen: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
