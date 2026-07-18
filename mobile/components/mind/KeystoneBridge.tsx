import React, { useEffect, useMemo } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import type { ConvergenceSignal, IntelNode } from '@/types/api';
import { DetailShell, stageInk } from './DetailShell';

// ─────────────────────────────────────────────────────────────────────────
// KeystoneBridge — the Convergence detail view. Two source clusters sit far
// apart. On mount a glowing keystone (the shared idea) drops into the gap,
// tension lines snap out to every capture, and the clusters are physically
// pulled toward each other — different starting points, one destination.
// ─────────────────────────────────────────────────────────────────────────

const { width: SW, height: SH } = Dimensions.get('window');
const STAGE_H = SH * 0.52;
const KEY_X = SW / 2;
const KEY_Y = STAGE_H * 0.42;
const KEY_DROP_FROM = -70;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);

// Blob offsets for up to 4 members per cluster.
const MEMBER_OFFSETS = [
  { dx: 0, dy: 0, r: 13 },
  { dx: 30, dy: -34, r: 9 },
  { dx: -26, dy: 34, r: 9 },
  { dx: 34, dy: 30, r: 8 },
];

type ClusterGeom = {
  startX: number;
  endX: number;
  cy: number;
  source: string;
  items: IntelNode[];
};

export interface KeystoneBridgeProps {
  data: ConvergenceSignal;
  color: string;
  background: string;
  onClose: () => void;
  onOpenItem: (id: string) => void;
}

export function KeystoneBridge({ data, color, background, onClose, onOpenItem }: KeystoneBridgeProps) {
  const clusters = useMemo<ClusterGeom[]>(() => {
    const [a, b] = data.clusters ?? [];
    if (!a || !b) return [];
    return [
      { startX: SW * 0.15, endX: SW * 0.3, cy: STAGE_H * 0.36, source: a.source, items: a.items.slice(0, 4) },
      { startX: SW * 0.85, endX: SW * 0.7, cy: STAGE_H * 0.52, source: b.source, items: b.items.slice(0, 4) },
    ];
  }, [data]);

  // Sequence: keystone drops → lines snap taut → clusters get pulled inward.
  const drop = useSharedValue(0);
  const snap = useSharedValue(0);
  const pull = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(() => {
    drop.value = withTiming(1, { duration: 680, easing: Easing.out(Easing.cubic) });
    snap.value = withDelay(700, withTiming(1, { duration: 560, easing: Easing.out(Easing.quad) }));
    pull.value = withDelay(1300, withTiming(1, { duration: 950, easing: Easing.inOut(Easing.cubic) }));
    glow.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [drop, snap, pull, glow]);

  const keystoneProps = useAnimatedProps(() => ({
    cy: interpolate(drop.value, [0, 1], [KEY_DROP_FROM, KEY_Y]),
    opacity: interpolate(drop.value, [0, 0.15, 1], [0, 1, 1]),
  }));
  const glowProps = useAnimatedProps(() => ({
    cy: interpolate(drop.value, [0, 1], [KEY_DROP_FROM, KEY_Y]),
    r: 24 + glow.value * 9,
    opacity: drop.value * (0.3 - glow.value * 0.14),
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: snap.value }));

  return (
    <DetailShell typeLabel="CONVERGENCE" accent={color} background={background} onClose={onClose}>
      <View style={{ height: STAGE_H }}>
        <Svg width={SW} height={STAGE_H} style={StyleSheet.absoluteFill}>
          {clusters.map((cluster, ci) =>
            cluster.items.map((item, i) => (
              <TensionLine
                key={`l-${item.id}`}
                cluster={cluster}
                memberIndex={i}
                order={ci * 4 + i}
                color={color}
                snap={snap}
                pull={pull}
              />
            )),
          )}
          {clusters.map((cluster) =>
            cluster.items.map((item, i) => (
              <MemberDot key={`m-${item.id}`} cluster={cluster} memberIndex={i} color={color} pull={pull} />
            )),
          )}
          <AnimatedCircle cx={KEY_X} fill={color} animatedProps={glowProps} />
          <AnimatedCircle cx={KEY_X} r={13} fill={color} animatedProps={keystoneProps} />
        </Svg>

        {/* The keystone's name — kept to one compact chip so it never
            collides with the web; the arrival idea headlines the footer. */}
        <Animated.View style={[styles.keyLabel, labelStyle]} pointerEvents="none">
          <View style={styles.keyChip}>
            <Text variant="monoSmall" numberOfLines={1} style={{ color, letterSpacing: 2, textAlign: 'center' }}>
              {data.topicName.toUpperCase()}
            </Text>
          </View>
        </Animated.View>

        {clusters.map((cluster, ci) => (
          <ClusterOverlay
            key={`c-${ci}`}
            cluster={cluster}
            align={ci === 0 ? 'left' : 'right'}
            pull={pull}
            onOpenItem={onOpenItem}
          />
        ))}
      </View>

      <ScrollView style={styles.footer} showsVerticalScrollIndicator={false} contentContainerStyle={styles.footerContent}>
        <Text variant="monoSmall" style={{ color: stageInk(0.42) }}>
          {data.sourceCount} sources · {data.captureCount} captures · one destination
        </Text>
        {data.arrival ? (
          <Text variant="h3" style={{ color: stageInk(0.94), marginTop: Spacing[3] }}>
            {data.arrival}
          </Text>
        ) : null}
        <View style={[styles.signal, { borderLeftColor: color }]}>
          <Text variant="body" style={{ color: stageInk(0.88) }}>
            {data.signal}
          </Text>
        </View>
        {data.act ? (
          <View style={[styles.signal, { borderLeftColor: color, marginTop: Spacing[4] }]}>
            <Text variant="monoSmall" style={{ color, letterSpacing: 2 }}>WHERE THIS POINTS</Text>
            <Text variant="bodyMedium" style={{ color: stageInk(0.9), marginTop: 2 }}>
              {data.act}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </DetailShell>
  );
}

function memberX(cluster: ClusterGeom, memberIndex: number, pullValue: number): number {
  'worklet';
  const o = MEMBER_OFFSETS[memberIndex];
  return cluster.startX + (cluster.endX - cluster.startX) * pullValue + o.dx;
}

function MemberDot({
  cluster,
  memberIndex,
  color,
  pull,
}: {
  cluster: ClusterGeom;
  memberIndex: number;
  color: string;
  pull: SharedValue<number>;
}) {
  const o = MEMBER_OFFSETS[memberIndex];
  const props = useAnimatedProps(() => ({ cx: memberX(cluster, memberIndex, pull.value) }));
  return (
    <AnimatedCircle
      cy={cluster.cy + o.dy}
      r={o.r}
      fill={color}
      fillOpacity={memberIndex === 0 ? 0.85 : 0.5}
      animatedProps={props}
    />
  );
}

function TensionLine({
  cluster,
  memberIndex,
  order,
  color,
  snap,
  pull,
}: {
  cluster: ClusterGeom;
  memberIndex: number;
  order: number;
  color: string;
  snap: SharedValue<number>;
  pull: SharedValue<number>;
}) {
  const o = MEMBER_OFFSETS[memberIndex];
  const props = useAnimatedProps(() => {
    // Staggered snap: each line whips out slightly after the previous one.
    const t = interpolate(snap.value, [order * 0.06, order * 0.06 + 0.55], [0, 1], Extrapolation.CLAMP);
    const nx = memberX(cluster, memberIndex, pull.value);
    const ny = cluster.cy + o.dy;
    return {
      x2: KEY_X + (nx - KEY_X) * t,
      y2: KEY_Y + (ny - KEY_Y) * t,
      strokeOpacity: t * 0.45,
    };
  });
  return <AnimatedLine x1={KEY_X} y1={KEY_Y} stroke={color} strokeWidth={1.1} animatedProps={props} />;
}

function ClusterOverlay({
  cluster,
  align,
  pull,
  onOpenItem,
}: {
  cluster: ClusterGeom;
  align: 'left' | 'right';
  pull: SharedValue<number>;
  onOpenItem: (id: string) => void;
}) {
  // The whole overlay (label + hit areas) rides along with the pulled cluster.
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: (cluster.endX - cluster.startX) * pull.value }],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="box-none">
      {cluster.items.map((item, i) => {
        const o = MEMBER_OFFSETS[i];
        return (
          <Pressable
            key={item.id}
            onPress={() => onOpenItem(item.id)}
            style={[
              styles.memberHit,
              { left: cluster.startX + o.dx - 20, top: cluster.cy + o.dy - 20 },
            ]}
            accessibilityLabel={`Open capture: ${item.label}`}
          />
        );
      })}
      <View
        style={[
          styles.clusterLabel,
          { top: cluster.cy + 58 },
          align === 'left'
            ? { left: Math.max(Spacing[4], cluster.startX - 70) }
            : { right: Math.max(Spacing[4], SW - cluster.startX - 70) },
        ]}
        pointerEvents="none"
      >
        <Text variant="monoSmall" numberOfLines={1} style={{ color: stageInk(0.55) }}>
          {cluster.source}
        </Text>
        <Text variant="monoSmall" style={{ color: stageInk(0.32) }}>
          {cluster.items.length} {cluster.items.length === 1 ? 'capture' : 'captures'}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  keyLabel: {
    position: 'absolute',
    left: SW * 0.28,
    right: SW * 0.28,
    top: KEY_Y + 24,
    alignItems: 'center',
  },
  keyChip: {
    backgroundColor: 'rgba(10,10,12,0.82)',
    borderRadius: 999,
    paddingHorizontal: Spacing[3],
    paddingVertical: 3,
    maxWidth: '100%',
  },
  memberHit: { position: 'absolute', width: 40, height: 40, borderRadius: 20 },
  clusterLabel: { position: 'absolute', width: 140 },
  footer: { flex: 1 },
  footerContent: { paddingHorizontal: Spacing[6], paddingTop: Spacing[5], paddingBottom: Spacing[12] },
  signal: {
    marginTop: Spacing[3],
    borderLeftWidth: 2,
    paddingLeft: Spacing[4],
    paddingVertical: Spacing[1],
  },
});
