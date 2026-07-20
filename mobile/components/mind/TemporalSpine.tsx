import React, { useMemo, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  Extrapolation,
  FadeIn,
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
// screen carrying bare, tappable points (one per capture, oldest first).
// Tapping a point opens a small card beside the line with the capture's
// title; the line itself stays clean. The AI's drift notes sit to the sides
// of the spine, never on it, and the spine resolves into the synthesized
// position at the end.
// ─────────────────────────────────────────────────────────────────────────

const { width: SW, height: SH } = Dimensions.get('window');

const TOP_PAD = 96; // room for the thread header before the first node
const NODE_H = 72;
const SWAY = SW * 0.2; // how far nodes swing off the center line
// A drift box owns the bend's pocket: the 48% of the width the spine has not
// yet crossed into at the top of the slot.
const DRIFT_FAR_EDGE = SW * 0.52;

// A drift box's height grows with its text so the note never gets clipped.
const DRIFT_LABEL_H = 34; // "DRIFT" label + margin
const DRIFT_LINE_H = 20;
const DRIFT_CHARS_PER_LINE = 30; // approx chars that fit the drift column width
const DRIFT_PAD_V = Spacing[2] * 2;
const DRIFT_BUFFER = 14; // breathing room before the next row

function estimateDriftHeight(text: string): number {
  const lines = Math.max(1, Math.ceil(text.length / DRIFT_CHARS_PER_LINE));
  return DRIFT_LABEL_H + lines * DRIFT_LINE_H + DRIFT_PAD_V + DRIFT_BUFFER;
}

type Row =
  | { kind: 'node'; y: number; x: number; index: number; id: string; label: string; capturedAt: string }
  | { kind: 'drift'; y: number; height: number; text: string; side: 'left' | 'right' };

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
  const [selected, setSelected] = useState<number | null>(null);

  const { rows, spineHeight, path } = useMemo(() => {
    const out: Row[] = [];
    // Spine waypoints (node centers + bend "shoulders"). The path is drawn
    // through these; only `kind: 'node'` rows carry a dot.
    const spinePts: { x: number; y: number }[] = [];
    const lastIndex = timeline.length - 1;
    let y = TOP_PAD;
    timeline.forEach((node, i) => {
      const onLeft = i % 2 === 0;
      const x = SW * 0.5 + (onLeft ? -SWAY : SWAY);
      const cy = y + NODE_H / 2;
      out.push({ kind: 'node', y, x, index: i, id: node.id, label: node.label, capturedAt: node.capturedAt });
      spinePts.push({ x, y: cy });
      y += NODE_H;

      const notes = driftNotes.filter((n) => n.atIndex === i);
      if (notes.length === 0) return;

      if (i < lastIndex) {
        // A drift lives beside a STRAIGHT run of the spine, with the bend to
        // the next node completed just ABOVE it. Concentrate that bend into a
        // short shoulder, then run the spine straight down at the next node's
        // x while the note fills the pocket the spine just vacated — so the box
        // always has clear space to grow downward, never landing on the line.
        const nextOnLeft = (i + 1) % 2 === 0;
        const nextX = SW * 0.5 + (nextOnLeft ? -SWAY : SWAY);
        const shoulderY = y + NODE_H / 2; // bend ends here, straight run begins
        spinePts.push({ x: nextX, y: shoulderY });

        let dy = shoulderY;
        for (const note of notes) {
          const height = estimateDriftHeight(note.text);
          // Vacated side: the spine has moved to nextX, so node i's own side
          // is now open.
          out.push({ kind: 'drift', y: dy, height, text: note.text, side: onLeft ? 'left' : 'right' });
          dy += height;
        }
        // Next node's center sits at the bottom of the straight run, so the
        // straight segment (shoulder → next node) runs the full drift height.
        y = dy - NODE_H / 2;
      } else {
        // Drift after the last node: the spine ends here, so there is no line
        // below to avoid — keep it opposite the node and stack downward.
        for (const note of notes) {
          const height = estimateDriftHeight(note.text);
          out.push({ kind: 'drift', y, height, text: note.text, side: onLeft ? 'right' : 'left' });
          y += height;
        }
      }
    });

    // Smooth S-curve through the waypoints: vertical tangents at each point so
    // the spline flows down rather than zig-zagging. A shoulder→next-node pair
    // shares an x, making that stretch a clean vertical line beside the drift.
    let d = '';
    spinePts.forEach((n, i) => {
      if (i === 0) {
        d = `M${n.x},${n.y}`;
      } else {
        const prev = spinePts[i - 1];
        const mid = (prev.y + n.y) / 2;
        d += ` C${prev.x},${mid} ${n.x},${mid} ${n.x},${n.y}`;
      }
    });

    return { rows: out, spineHeight: y + Spacing[6], path: d };
  }, [timeline, driftNotes]);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <DetailShell typeLabel="THREAD" accent={color} background={background} onClose={onClose}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        {/* Thread header */}
        <View style={styles.head}>
          <Text variant="h2" style={{ color: stageInk(0.94) }}>{data.topicName}</Text>
          <Text variant="monoSmall" style={{ color: stageInk(0.42), marginTop: Spacing[1] }}>
            {data.captureCount} captures · oldest first
          </Text>
          <Text variant="monoSmall" style={{ color, marginTop: Spacing[1], opacity: 0.85 }}>
            Tap a point to see the capture
          </Text>
        </View>

        {/* The spine */}
        <View style={{ height: spineHeight }}>
          <Svg width={SW} height={spineHeight} style={StyleSheet.absoluteFill}>
            <Path d={path} fill="none" stroke={color} strokeOpacity={0.34} strokeWidth={1.6} />
            {rows.map((row) =>
              row.kind === 'node' ? (
                <React.Fragment key={`dot-${row.id}`}>
                  <Circle
                    cx={row.x} cy={row.y + NODE_H / 2} r={selected === row.index ? 15 : 12}
                    fill={color} fillOpacity={selected === row.index ? 0.28 : 0.13}
                  />
                  <Circle cx={row.x} cy={row.y + NODE_H / 2} r={6} fill={color} fillOpacity={0.92} />
                </React.Fragment>
              ) : null,
            )}
          </Svg>

          {rows.map((row, i) => {
            if (row.kind === 'drift') {
              return (
                <FadeInBlock key={`d-${i}`} top={row.y} height={row.height} side={row.side} scrollY={scrollY}>
                  <View style={[styles.drift, { borderLeftColor: color }]}>
                    <Text variant="monoSmall" style={{ color, letterSpacing: 2 }}>DRIFT</Text>
                    <Text variant="body" style={{ color: stageInk(0.82), marginTop: Spacing[1] }}>
                      {row.text}
                    </Text>
                  </View>
                </FadeInBlock>
              );
            }
            const onLeft = row.x < SW / 2;
            return (
              <React.Fragment key={`n-${row.id}`}>
                {/* date whispers under the point */}
                <Text
                  variant="monoSmall"
                  style={[styles.date, { left: row.x - 40, top: row.y + NODE_H / 2 + 16 }]}
                >
                  {fmtDate(row.capturedAt)}
                </Text>
                <Pressable
                  onPress={() => setSelected((cur) => (cur === row.index ? null : row.index))}
                  style={[styles.nodeHit, { left: row.x - 26, top: row.y + NODE_H / 2 - 26 }]}
                  accessibilityLabel={`Show capture from ${fmtDate(row.capturedAt)}`}
                />
                {selected === row.index && (
                  <Animated.View
                    entering={FadeIn.duration(160)}
                    style={[
                      styles.nodeCard,
                      { top: row.y - 6 },
                      onLeft
                        ? { left: row.x + 30, right: Spacing[4] }
                        : { right: SW - row.x + 30, left: Spacing[4] },
                    ]}
                  >
                    <Text variant="monoSmall" style={{ color: stageInk(0.4) }}>
                      {fmtDate(row.capturedAt)}
                    </Text>
                    <Text variant="bodyMedium" numberOfLines={3} style={{ color: stageInk(0.92), marginTop: 2 }}>
                      {row.label}
                    </Text>
                    <Pressable onPress={() => onOpenItem(row.id)} hitSlop={8} style={{ marginTop: Spacing[2] }}>
                      <Text variant="monoSmall" style={{ color }}>Open capture →</Text>
                    </Pressable>
                  </Animated.View>
                )}
              </React.Fragment>
            );
          })}
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

/** Fades content in as its position scrolls into the lower third of the view. */
function FadeInBlock({
  top,
  height,
  side,
  scrollY,
  children,
}: {
  top: number;
  height: number;
  side: 'left' | 'right';
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
    <Animated.View
      style={[
        styles.driftWrap,
        { top, height },
        side === 'left'
          ? { left: Spacing[4], right: DRIFT_FAR_EDGE }
          : { right: Spacing[4], left: DRIFT_FAR_EDGE },
        style,
      ]}
    >
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
  date: {
    position: 'absolute',
    width: 80,
    textAlign: 'center',
    color: 'rgba(236,236,236,0.35)',
  },
  nodeHit: { position: 'absolute', width: 52, height: 52, borderRadius: 26 },
  nodeCard: {
    position: 'absolute',
    backgroundColor: 'rgba(10,10,12,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(236,236,236,0.16)',
    borderRadius: 12,
    padding: Spacing[3],
    zIndex: 5,
    elevation: 5,
  },
  // Top-anchored: the box lives in the bend's pocket before the spine
  // crosses to its side of the screen.
  driftWrap: { position: 'absolute', justifyContent: 'flex-start', paddingTop: 6 },
  drift: { borderLeftWidth: 2, paddingLeft: Spacing[3], paddingVertical: Spacing[2] },
  end: { paddingHorizontal: Spacing[6], paddingBottom: Spacing[16], paddingTop: Spacing[4] },
  endMarker: { width: 24, height: 2, borderRadius: 1, marginBottom: Spacing[4], opacity: 0.8 },
  ctaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing[8],
    paddingTop: Spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(236,236,236,0.14)',
  },
});
