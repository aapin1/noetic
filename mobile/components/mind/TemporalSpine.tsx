import React, { useMemo } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import type { ThreadSynthesis } from '@/types/api';
import { DetailShell, stageInk } from './DetailShell';

// ─────────────────────────────────────────────────────────────────────────
// TemporalSpine — the Threads detail view. A vertical spline runs down the
// screen; captures sit on it in the order they were saved. Scrolling reveals
// the AI's drift notes (how the thinking moved) at their point in the
// sequence, and the spine resolves into the synthesized position at the end.
// ─────────────────────────────────────────────────────────────────────────

const { width: SW, height: SH } = Dimensions.get('window');

const TOP_PAD = 84; // room for the thread header before the first node
const NODE_H = 96;
const DRIFT_H = 118;
const SWAY = SW * 0.16; // how far nodes swing off the center line

type Row =
  | { kind: 'node'; y: number; x: number; index: number; id: string; label: string; capturedAt: string }
  | { kind: 'drift'; y: number; text: string };

export interface TemporalSpineProps {
  data: ThreadSynthesis;
  color: string;
  background: string;
  onClose: () => void;
  onOpenItem: (id: string) => void;
  onContinueCompanion: () => void;
  onViewAtlas: () => void;
}

export function TemporalSpine({
  data,
  color,
  background,
  onClose,
  onOpenItem,
  onContinueCompanion,
  onViewAtlas,
}: TemporalSpineProps) {
  const timeline = data.timeline ?? [];
  const driftNotes = data.driftNotes ?? [];

  const { rows, spineHeight, path } = useMemo(() => {
    const out: Row[] = [];
    let y = TOP_PAD;
    timeline.forEach((node, i) => {
      const x = SW * 0.5 + (i % 2 === 0 ? -SWAY : SWAY);
      out.push({ kind: 'node', y, x, index: i, id: node.id, label: node.label, capturedAt: node.capturedAt });
      y += NODE_H;
      for (const note of driftNotes) {
        if (note.atIndex === i) {
          out.push({ kind: 'drift', y, text: note.text });
          y += DRIFT_H;
        }
      }
    });

    // Smooth S-curve through the node centers: vertical tangents at each node
    // so the spline flows down rather than zig-zagging.
    const nodes = out.filter((r): r is Extract<Row, { kind: 'node' }> => r.kind === 'node');
    let d = '';
    nodes.forEach((n, i) => {
      const cy = n.y + NODE_H / 2;
      if (i === 0) {
        d = `M${n.x},${cy}`;
      } else {
        const prev = nodes[i - 1];
        const py = prev.y + NODE_H / 2;
        const mid = (py + cy) / 2;
        d += ` C${prev.x},${mid} ${n.x},${mid} ${n.x},${cy}`;
      }
    });

    return { rows: out, spineHeight: y + Spacing[6], path: d };
  }, [timeline, driftNotes]);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  return (
    <DetailShell typeLabel="THREAD" accent={color} background={background} onClose={onClose}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        {/* Thread header */}
        <View style={styles.head}>
          <Text variant="h2" style={{ color: stageInk(0.94) }}>{data.topicName}</Text>
          <Text variant="monoSmall" style={{ color: stageInk(0.42), marginTop: Spacing[1] }}>
            {data.captureCount} captures · oldest first
          </Text>
        </View>

        {/* The spine */}
        <View style={{ height: spineHeight }}>
          <Svg width={SW} height={spineHeight} style={StyleSheet.absoluteFill}>
            <Path d={path} fill="none" stroke={color} strokeOpacity={0.34} strokeWidth={1.6} />
            {rows.map((row) =>
              row.kind === 'node' ? (
                <React.Fragment key={`dot-${row.id}`}>
                  <Circle cx={row.x} cy={row.y + NODE_H / 2} r={13} fill={color} fillOpacity={0.14} />
                  <Circle cx={row.x} cy={row.y + NODE_H / 2} r={6} fill={color} fillOpacity={0.9} />
                </React.Fragment>
              ) : null,
            )}
          </Svg>

          {rows.map((row, i) =>
            row.kind === 'node' ? (
              <NodeRow key={`n-${row.id}`} row={row} color={color} onPress={() => onOpenItem(row.id)} />
            ) : (
              <FadeInBlock key={`d-${i}`} top={row.y} scrollY={scrollY}>
                <View style={[styles.drift, { borderLeftColor: color }]}>
                  <Text variant="monoSmall" style={{ color, letterSpacing: 2 }}>DRIFT</Text>
                  <Text variant="body" numberOfLines={3} style={{ color: stageInk(0.82), marginTop: Spacing[1] }}>
                    {row.text}
                  </Text>
                </View>
              </FadeInBlock>
            ),
          )}
        </View>

        {/* Where the spine resolves: the position, then the open question */}
        <FadeInSection scrollY={scrollY}>
          <View style={styles.end}>
            <View style={[styles.endMarker, { backgroundColor: color }]} />
            <Text variant="monoSmall" style={{ color, letterSpacing: 2 }}>WHERE YOU'VE LANDED</Text>
            <Text variant="h3" style={{ color: stageInk(0.94), marginTop: Spacing[3] }}>
              {data.position}
            </Text>
            <Text variant="monoSmall" style={{ color, letterSpacing: 2, marginTop: Spacing[6] }}>
              OPEN QUESTION
            </Text>
            <Text variant="body" style={{ color: stageInk(0.78), marginTop: Spacing[2] }}>
              {data.openQuestion}
            </Text>
            {data.nextMove ? (
              <View style={[styles.nextMove, { borderLeftColor: color }]}>
                <Text variant="monoSmall" style={{ color, letterSpacing: 2 }}>NEXT MOVE</Text>
                <Text variant="bodyMedium" style={{ color: stageInk(0.9), marginTop: 2 }}>
                  {data.nextMove}
                </Text>
              </View>
            ) : null}
            <View style={styles.ctaRow}>
              <Pressable onPress={onContinueCompanion} hitSlop={8}>
                <Text variant="monoSmall" style={{ color: stageInk(0.6) }}>Continue in companion →</Text>
              </Pressable>
              <Pressable onPress={onViewAtlas} hitSlop={8}>
                <Text variant="monoSmall" style={{ color: stageInk(0.6) }}>View in Atlas →</Text>
              </Pressable>
            </View>
          </View>
        </FadeInSection>
      </Animated.ScrollView>
    </DetailShell>
  );
}

function NodeRow({
  row,
  color,
  onPress,
}: {
  row: Extract<Row, { kind: 'node' }>;
  color: string;
  onPress: () => void;
}) {
  const onLeft = row.x < SW / 2; // dot on the left → text on the right
  const date = new Date(row.capturedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.nodeRow,
        { top: row.y },
        onLeft
          ? { left: row.x + 26, right: Spacing[6], alignItems: 'flex-start' }
          : { right: SW - row.x + 26, left: Spacing[6], alignItems: 'flex-end' },
      ]}
      accessibilityLabel={`Open capture: ${row.label}`}
    >
      <Text variant="monoSmall" style={{ color: stageInk(0.4) }}>{date}</Text>
      <Text
        variant="bodyMedium"
        numberOfLines={2}
        style={{ color: stageInk(0.88), marginTop: 2, textAlign: onLeft ? 'left' : 'right' }}
      >
        {row.label}
      </Text>
    </Pressable>
  );
}

/** Fades content in as its position scrolls into the lower third of the view. */
function FadeInBlock({
  top,
  scrollY,
  children,
}: {
  top: number;
  scrollY: SharedValue<number>;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    // Content above the first fold is visible immediately.
    const reveal = top + TOP_PAD - SH * 0.82;
    if (reveal <= 0) return { opacity: 1, transform: [{ translateY: 0 }] };
    const t = interpolate(scrollY.value, [reveal, reveal + SH * 0.22], [0, 1], Extrapolation.CLAMP);
    return { opacity: t, transform: [{ translateY: (1 - t) * 14 }] };
  });
  return (
    <Animated.View style={[styles.driftWrap, { top }, style]}>
      {children}
    </Animated.View>
  );
}

/** Same reveal treatment for the closing synthesis section (in normal flow). */
function FadeInSection({ scrollY, children }: { scrollY: SharedValue<number>; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => {
    const t = interpolate(scrollY.value, [0, SH * 0.3], [0.55, 1], Extrapolation.CLAMP);
    return { opacity: t };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: Spacing[6], paddingTop: Spacing[2] },
  nodeRow: { position: 'absolute', height: NODE_H, justifyContent: 'center' },
  driftWrap: { position: 'absolute', left: Spacing[6], right: Spacing[6], height: DRIFT_H, justifyContent: 'center' },
  drift: { borderLeftWidth: 2, paddingLeft: Spacing[4], paddingVertical: Spacing[2] },
  end: { paddingHorizontal: Spacing[6], paddingBottom: Spacing[16], paddingTop: Spacing[4] },
  endMarker: { width: 24, height: 2, borderRadius: 1, marginBottom: Spacing[4], opacity: 0.8 },
  nextMove: {
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
    borderTopColor: 'rgba(236,236,236,0.14)',
  },
});
