import React, { useEffect, useMemo } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import type { ContradictionCard, IntelNode } from '@/types/api';
import { DetailShell, stageInk } from './DetailShell';

// ─────────────────────────────────────────────────────────────────────────
// FractureZone — the Contradictions detail view. No connecting lines: two
// opposing masses (each pole plus the captures that reinforce it) face each
// other across a jagged central chasm, slowly pressing toward it. The crux —
// the question the collision turns on — sits at the base of the rift; below
// the stage, the friction is named and a concrete way to settle it offered.
// ─────────────────────────────────────────────────────────────────────────

const { width: SW, height: SH } = Dimensions.get('window');
const STAGE_H = SH * 0.5;
const CHASM_HALF = 15;
const POLE_R = 30;

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Jagged vertical edge around x, deterministic per seed. */
function jaggedEdge(x: number, seed: number, height: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const STEP = 46;
  for (let y = 0, i = 0; y <= height + STEP; y += STEP, i++) {
    const wobble = ((seed + i * 2654435761) % 23) - 11; // -11..11
    pts.push({ x: x + wobble, y: Math.min(y, height) });
  }
  return pts;
}

function toPath(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
}

/** Satellites sit below/beside their pole — the space above holds the label. */
const SAT_OFFSETS = [
  { dx: -34, dy: 46 },
  { dx: 36, dy: 44 },
  { dx: 2, dy: 70 },
];

type Mass = {
  cx: number;
  cy: number;
  pole: IntelNode;
  satellites: IntelNode[];
};

export interface FractureZoneProps {
  data: ContradictionCard;
  color: string;
  background: string;
  onClose: () => void;
  onOpenItem: (id: string) => void;
}

export function FractureZone({ data, color, background, onClose, onOpenItem }: FractureZoneProps) {
  const masses = useMemo<{ a: Mass; b: Mass }>(
    () => ({
      a: {
        cx: SW * 0.25,
        cy: STAGE_H * 0.34,
        pole: { id: data.itemAId, label: data.labelA },
        satellites: (data.sideA ?? []).slice(0, 3),
      },
      b: {
        cx: SW * 0.75,
        cy: STAGE_H * 0.52,
        pole: { id: data.itemBId, label: data.labelB },
        satellites: (data.sideB ?? []).slice(0, 3),
      },
    }),
    [data],
  );

  const seed = useMemo(() => hashId(data.itemAId + data.itemBId), [data]);
  const { chasmFill, chasmLeft, chasmRight } = useMemo(() => {
    const left = jaggedEdge(SW / 2 - CHASM_HALF, seed, STAGE_H);
    const right = jaggedEdge(SW / 2 + CHASM_HALF, seed * 7 + 13, STAGE_H);
    const fill = `${toPath(left)}L${[...right].reverse().map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`;
    return { chasmFill: fill, chasmLeft: toPath(left), chasmRight: toPath(right) };
  }, [seed]);

  // The masses breathe toward the rift; the rift itself faintly shimmers.
  // On mount each side's web populates: satellites travel out from their pole
  // along drawing lines (the same character as the KeystoneBridge snap).
  const press = useSharedValue(0);
  const pop = useSharedValue(0);
  useEffect(() => {
    press.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    pop.value = withTiming(1, { duration: 1150, easing: Easing.out(Easing.cubic) });
  }, [press, pop]);

  const leftProps = useAnimatedProps(() => ({ x: press.value * 5 }));
  const rightProps = useAnimatedProps(() => ({ x: -press.value * 5 }));
  const shimmerProps = useAnimatedProps(() => ({ strokeOpacity: 0.16 + press.value * 0.22 }));
  const leftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: press.value * 5 }] }));
  const rightStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -press.value * 5 }] }));

  const renderMass = (mass: Mass, order: number) => (
    <>
      <Circle cx={mass.cx} cy={mass.cy} r={POLE_R + 22} fill={color} fillOpacity={0.07} />
      <Circle cx={mass.cx} cy={mass.cy} r={POLE_R} fill={color} fillOpacity={0.85} />
      {mass.satellites.map((sat, i) => (
        <SatelliteWeb key={sat.id} mass={mass} index={i} order={order + i} color={color} pop={pop} />
      ))}
    </>
  );

  const massOverlay = (mass: Mass, side: 'A' | 'B') => (
    <>
      <View
        style={[
          styles.poleLabel,
          side === 'A'
            ? { left: Spacing[4], right: SW / 2 + CHASM_HALF + Spacing[3], alignItems: 'flex-start' }
            : { right: Spacing[4], left: SW / 2 + CHASM_HALF + Spacing[3], alignItems: 'flex-end' },
          { bottom: STAGE_H - mass.cy + POLE_R + 10 },
        ]}
        pointerEvents="none"
      >
        <Text
          variant="bodyMedium"
          numberOfLines={2}
          style={{ color: stageInk(0.85), textAlign: side === 'A' ? 'left' : 'right' }}
        >
          {mass.pole.label}
        </Text>
        {mass.satellites.length > 0 ? (
          <Text variant="monoSmall" style={{ color: stageInk(0.38), marginTop: 2 }}>
            +{mass.satellites.length} reinforcing
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => onOpenItem(mass.pole.id)}
        style={[styles.poleHit, { left: mass.cx - POLE_R, top: mass.cy - POLE_R }]}
        accessibilityLabel={`Open capture: ${mass.pole.label}`}
      >
        <Text
          variant="monoSmall"
          style={{ color: background, fontWeight: '700', textAlign: 'center', includeFontPadding: false }}
        >
          {side}
        </Text>
      </Pressable>
      {mass.satellites.map((sat, i) => {
        const o = SAT_OFFSETS[i];
        return (
          <Pressable
            key={sat.id}
            onPress={() => onOpenItem(sat.id)}
            style={[styles.satHit, { left: mass.cx + o.dx - 18, top: mass.cy + o.dy - 18 }]}
            accessibilityLabel={`Open capture: ${sat.label}`}
          />
        );
      })}
    </>
  );

  return (
    <DetailShell typeLabel="TENSION" accent={color} background={background} onClose={onClose}>
      <View style={styles.stage}>
        <Svg width={SW} height={STAGE_H} style={StyleSheet.absoluteFill}>
          {/* The chasm — a rift, not a link */}
          <Path d={chasmFill} fill="rgba(0,0,0,0.4)" />
          <Path d={chasmLeft} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1.2} />
          <Path d={chasmRight} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1.2} />
          <AnimatedPath
            d={chasmFill}
            fill="none"
            stroke={color}
            strokeWidth={0.8}
            animatedProps={shimmerProps}
          />
          <AnimatedG animatedProps={leftProps}>{renderMass(masses.a, 0)}</AnimatedG>
          <AnimatedG animatedProps={rightProps}>{renderMass(masses.b, 3)}</AnimatedG>
        </Svg>

        <Animated.View style={[StyleSheet.absoluteFill, leftStyle]} pointerEvents="box-none">
          {massOverlay(masses.a, 'A')}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, rightStyle]} pointerEvents="box-none">
          {massOverlay(masses.b, 'B')}
        </Animated.View>
      </View>

      {/* The crux sits at the base of the rift; everything below scrolls. */}
      <ScrollView style={styles.below} showsVerticalScrollIndicator={false} contentContainerStyle={styles.belowContent}>
        <View style={[styles.crux, { borderColor: color }]}>
          <Text variant="monoSmall" style={{ color, letterSpacing: 2 }}>THE CRUX</Text>
          <Text
            variant={data.crux ? 'h3' : 'body'}
            style={{ color: stageInk(0.94), marginTop: Spacing[2] }}
          >
            {data.crux ?? data.tension}
          </Text>
        </View>
        {data.crux ? (
          <Text variant="body" style={{ color: stageInk(0.75), marginTop: Spacing[4] }}>
            {data.tension}
          </Text>
        ) : null}
        {data.test ? (
          <View style={[styles.testRow, { borderLeftColor: color }]}>
            <Text variant="monoSmall" style={{ color, letterSpacing: 2 }}>ONE WAY TO SETTLE IT</Text>
            <Text variant="bodyMedium" style={{ color: stageInk(0.9), marginTop: 2 }}>
              {data.test}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </DetailShell>
  );
}

/** A satellite travels out from its pole along a drawing web-line on mount. */
function SatelliteWeb({
  mass,
  index,
  order,
  color,
  pop,
}: {
  mass: Mass;
  index: number;
  order: number;
  color: string;
  pop: SharedValue<number>;
}) {
  const o = SAT_OFFSETS[index];
  const lineProps = useAnimatedProps(() => {
    const t = interpolate(pop.value, [order * 0.09, order * 0.09 + 0.55], [0, 1], Extrapolation.CLAMP);
    return {
      x2: mass.cx + o.dx * t,
      y2: mass.cy + o.dy * t,
      strokeOpacity: t * 0.28,
    };
  });
  const dotProps = useAnimatedProps(() => {
    const t = interpolate(pop.value, [order * 0.09, order * 0.09 + 0.55], [0, 1], Extrapolation.CLAMP);
    return {
      cx: mass.cx + o.dx * t,
      cy: mass.cy + o.dy * t,
      r: 9 * t,
      fillOpacity: 0.4 * t,
    };
  });
  return (
    <>
      <AnimatedLine x1={mass.cx} y1={mass.cy} stroke={color} strokeWidth={1} animatedProps={lineProps} />
      <AnimatedCircle fill={color} animatedProps={dotProps} />
    </>
  );
}

const styles = StyleSheet.create({
  stage: { height: STAGE_H },
  poleHit: {
    position: 'absolute',
    width: POLE_R * 2,
    height: POLE_R * 2,
    borderRadius: POLE_R,
    alignItems: 'center',
    justifyContent: 'center',
  },
  satHit: { position: 'absolute', width: 36, height: 36, borderRadius: 18 },
  poleLabel: { position: 'absolute' },
  below: { flex: 1 },
  belowContent: { paddingHorizontal: Spacing[6], paddingBottom: Spacing[12] },
  crux: {
    alignSelf: 'center',
    width: SW * 0.8,
    marginTop: -46,
    backgroundColor: 'rgba(10,10,12,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: Spacing[4],
  },
  testRow: {
    marginTop: Spacing[4],
    borderLeftWidth: 2,
    paddingLeft: Spacing[4],
    paddingVertical: Spacing[1],
  },
});
