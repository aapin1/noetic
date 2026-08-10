import React, { useEffect, useMemo } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Line } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import type { DormantThread } from '@/types/api';
import { emberHeat } from './overviewSections';
import { DETAIL_PAGE_BOTTOM, DetailShell, useStageInk } from './DetailShell';

// ─────────────────────────────────────────────────────────────────────────
// BankedEmber — the Dormant detail view. A fire that was fed and then left:
// the core still holds heat (dimmer the longer it has been quiet), rings of
// warmth breathe out of it, and one ash mote per capture drifts up and dies.
// Below the hearth, the silence is drawn as a fuse — one dash per quiet day,
// burning down from the last spark to today — so the gap is a length on the
// screen rather than a number in a sentence.
// ─────────────────────────────────────────────────────────────────────────

const { width: SW, height: SH } = Dimensions.get('window');
const STAGE_H = SH * 0.4;
const EMBER_X = SW / 2;
const EMBER_Y = STAGE_H * 0.44;
const HEARTH_Y = STAGE_H * 0.74;

const RAIL_W = SW - Spacing[6] * 2;
const RAIL_H = 26;
const RAIL_MID = RAIL_H / 2;
const MAX_DASHES = 44; // past ~6 weeks the fuse reads as "long" either way

const MAX_MOTES = 10;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

type Mote = { dx: number; rise: number; phase: number; r: number };

function motesFor(topicId: string, captureCount: number): Mote[] {
  const n = Math.max(3, Math.min(MAX_MOTES, captureCount));
  const seed = hashId(topicId);
  return Array.from({ length: n }, (_, i) => {
    const a = (seed + i * 2654435761) % 1000;
    const b = (seed + i * 40503 + 977) % 1000;
    return {
      dx: (a / 1000 - 0.5) * 96, // drifts out to ±48 as it rises
      rise: 62 + (b / 1000) * 58,
      phase: ((a * 7 + b) % 1000) / 1000,
      r: 1.2 + (b / 1000) * 1.5,
    };
  });
}

export interface BankedEmberProps {
  data: DormantThread;
  color: string;
  background: string;
  onClose: () => void;
  onContinueCompanion: () => void;
  onOpenFolder: () => void;
}

export function BankedEmber({
  data,
  color,
  background,
  onClose,
  onContinueCompanion,
  onOpenFolder,
}: BankedEmberProps) {
  const ink = useStageInk();
  const c = useThemeColors();
  const heat = emberHeat(data.daysSilent);
  const motes = useMemo(() => motesFor(data.topicId, data.captureCount), [data]);
  // A fire that was fed more burns wider, even once it's down to coals.
  const coreR = 10 + Math.min(1, data.captureCount / 12) * 11;

  // The core breathes; the ash drifts on its own slower clock; the fuse burns
  // out once on arrival and then leaves the page still — this is the quiet
  // instrument, so nothing here demands attention twice.
  const breath = useSharedValue(0);
  const float = useSharedValue(0);
  const burn = useSharedValue(0);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    float.value = withRepeat(withTiming(1, { duration: 6400, easing: Easing.linear }), -1, false);
    burn.value = withDelay(520, withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }));
  }, [breath, float, burn]);

  const coreProps = useAnimatedProps(() => ({
    r: coreR * (1 + breath.value * 0.05),
    opacity: heat * (0.72 + breath.value * 0.28),
  }));

  const lastOn = useMemo(
    () =>
      new Date(data.lastCapturedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    [data.lastCapturedAt],
  );

  return (
    <DetailShell typeLabel="DORMANT" accent={color} background={background} onClose={onClose}>
      {/* One continuous page: the hearth scrolls away with the text */}
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.page}
      >
        <View style={styles.stage}>
          <Svg width={SW} height={STAGE_H} style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* Warmth still sitting on the hearth floor */}
            <Ellipse
              cx={EMBER_X}
              cy={HEARTH_Y}
              rx={SW * 0.3}
              ry={11}
              fill={color}
              fillOpacity={heat * 0.09}
            />
            <Line
              x1={Spacing[6]}
              y1={HEARTH_Y}
              x2={SW - Spacing[6]}
              y2={HEARTH_Y}
              stroke={ink(0.14)}
              strokeWidth={1}
            />

            <HeatRing r={coreR + 16} base={heat * 0.3} color={color} breath={breath} />
            <HeatRing r={coreR + 36} base={heat * 0.17} color={color} breath={breath} />
            <HeatRing r={coreR + 58} base={heat * 0.08} color={color} breath={breath} />

            {motes.map((m, i) => (
              <AshMote key={i} mote={m} color={color} heat={heat} float={float} />
            ))}

            <AnimatedCircle cx={EMBER_X} cy={EMBER_Y} fill={color} animatedProps={coreProps} />
            <Circle cx={EMBER_X} cy={EMBER_Y} r={coreR * 0.34} fill={color} fillOpacity={heat} />
          </Svg>

          {/* The ember is named by the topic it burned through */}
          <View style={styles.chipWrap} pointerEvents="none">
            <View style={[styles.chip, { backgroundColor: c.surface }]}>
              <Text
                variant="monoSmall"
                numberOfLines={2}
                style={{ color, letterSpacing: 2, textAlign: 'center' }}
              >
                {data.topicName.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.below}>
          <View style={[styles.card, { borderColor: color, backgroundColor: c.surface }]}>
            <Text variant="monoSmall" style={{ color, letterSpacing: 2 }}>QUIET FOR</Text>
            <Text variant="h2" style={{ color: ink(0.94), marginTop: Spacing[2] }}>
              {data.daysSilent} {data.daysSilent === 1 ? 'day' : 'days'}
            </Text>
            <Text variant="monoSmall" style={{ color: ink(0.45), marginTop: Spacing[2] }}>
              {data.captureCount} {data.captureCount === 1 ? 'capture' : 'captures'} · last on {lastOn}
            </Text>
          </View>

          <SilenceRail daysSilent={data.daysSilent} heat={heat} color={color} burn={burn} />
          <View style={styles.railLabels}>
            <Text variant="monoSmall" style={{ color: ink(0.42) }}>last spark</Text>
            <Text variant="monoSmall" style={{ color: ink(0.42) }}>today</Text>
          </View>

          <Text variant="body" style={{ color: ink(0.75), marginTop: Spacing[6] }}>
            {data.captureCount} {data.captureCount === 1 ? 'capture' : 'captures'} went into this
            before it went quiet. Nothing has been lost — the folder is intact, and one new capture
            is enough to put it back in play.
          </Text>

          <View style={[styles.nextRow, { borderLeftColor: color }]}>
            <Text variant="monoSmall" style={{ color, letterSpacing: 2 }}>ONE WAY BACK IN</Text>
            <Text variant="bodyMedium" style={{ color: ink(0.9), marginTop: 2 }}>
              Ask the companion what you left unfinished here, or reopen the folder and reread the
              last thing you saved.
            </Text>
          </View>

          <View style={[styles.ctaRow, { borderTopColor: ink(0.18) }]}>
            <Pressable onPress={onContinueCompanion} hitSlop={8}>
              <Text variant="monoSmall" style={{ color: ink(0.6) }}>Continue in companion →</Text>
            </Pressable>
            <Pressable onPress={onOpenFolder} hitSlop={8}>
              <Text variant="monoSmall" style={{ color: ink(0.6) }}>Open the folder →</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </DetailShell>
  );
}

/** A ring of residual warmth, breathing out of the core. */
function HeatRing({
  r,
  base,
  color,
  breath,
}: {
  r: number;
  base: number;
  color: string;
  breath: SharedValue<number>;
}) {
  const props = useAnimatedProps(() => ({
    r: r + breath.value * 6,
    opacity: base * (0.6 + breath.value * 0.4),
  }));
  return (
    <AnimatedCircle
      cx={EMBER_X}
      cy={EMBER_Y}
      fill="none"
      stroke={color}
      strokeWidth={1}
      animatedProps={props}
    />
  );
}

/** One capture's worth of ash: lifts off the core, drifts out, goes dark. */
function AshMote({
  mote,
  color,
  heat,
  float,
}: {
  mote: Mote;
  color: string;
  heat: number;
  float: SharedValue<number>;
}) {
  const props = useAnimatedProps(() => {
    const p = (float.value + mote.phase) % 1;
    return {
      cx: EMBER_X + mote.dx * p,
      cy: EMBER_Y - 10 - mote.rise * p,
      r: mote.r,
      // Sine so it is invisible at both ends — the loop never snaps.
      opacity: heat * 0.5 * Math.sin(Math.PI * p),
    };
  });
  return <AnimatedCircle fill={color} animatedProps={props} />;
}

/**
 * The silence, drawn as a burnt-out fuse: one dash per quiet day running from
 * the last spark to today, each dimmer than the last. On arrival a single
 * ember runs the length of it once and dies at the far end.
 */
function SilenceRail({
  daysSilent,
  heat,
  color,
  burn,
}: {
  daysSilent: number;
  heat: number;
  color: string;
  burn: SharedValue<number>;
}) {
  const ink = useStageInk();
  const dashes = useMemo(() => {
    const n = Math.max(6, Math.min(MAX_DASHES, daysSilent));
    const step = RAIL_W / n;
    const w = Math.max(2, step * 0.52);
    return Array.from({ length: n }, (_, i) => ({
      x: i * step,
      w,
      opacity: heat * Math.max(0.07, 1 - i / Math.max(1, n - 1)),
    }));
  }, [daysSilent, heat]);

  const headProps = useAnimatedProps(() => ({
    cx: 3 + burn.value * (RAIL_W - 6),
    r: 4.5 - burn.value * 2.5,
    opacity: (1 - burn.value) * 0.9,
  }));

  return (
    <Svg width={RAIL_W} height={RAIL_H} style={styles.rail} pointerEvents="none">
      {dashes.map((d, i) => (
        <Line
          key={i}
          x1={d.x}
          y1={RAIL_MID}
          x2={d.x + d.w}
          y2={RAIL_MID}
          stroke={color}
          strokeOpacity={d.opacity}
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}
      <Circle cx={3} cy={RAIL_MID} r={4} fill={color} fillOpacity={0.95} />
      <Circle
        cx={RAIL_W - 4}
        cy={RAIL_MID}
        r={3.5}
        fill="none"
        stroke={ink(0.4)}
        strokeWidth={1}
      />
      <AnimatedCircle cy={RAIL_MID} fill={color} animatedProps={headProps} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  page: { paddingBottom: DETAIL_PAGE_BOTTOM },
  stage: { height: STAGE_H },
  // Bottom-anchored just above the hearth line, so a two-line topic name grows
  // up toward the ember instead of down into the card that overlaps the stage.
  chipWrap: {
    position: 'absolute',
    left: Spacing[8],
    right: Spacing[8],
    bottom: STAGE_H - HEARTH_Y + Spacing[3],
    alignItems: 'center',
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing[3],
    paddingVertical: 3,
    maxWidth: '100%',
  },
  below: { paddingHorizontal: Spacing[6] },
  card: {
    alignSelf: 'center',
    width: SW * 0.8,
    marginTop: -46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: Spacing[4],
  },
  rail: { marginTop: Spacing[8], alignSelf: 'center' },
  railLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing[1] },
  nextRow: {
    marginTop: Spacing[6],
    borderLeftWidth: 2,
    paddingLeft: Spacing[4],
    paddingVertical: Spacing[1],
  },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing[8],
    paddingTop: Spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
