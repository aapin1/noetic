import React, { useMemo } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import type {
  ContradictionCard,
  ConvergenceSignal,
  DormantThread,
  ThreadSynthesis,
} from '@/types/api';
import { stageInk } from './DetailShell';

// ─────────────────────────────────────────────────────────────────────────
// Mind's overview instruments. Each section's geometry IS its meaning:
// threads are woven strands moving rightward through time; contradictions
// are one continuous fault-crack splitting the section; convergence is
// streams physically merging into a point; dormant is embers burning down.
// No shared node-and-map grammar — that's Atlas's language, not Mind's.
// ─────────────────────────────────────────────────────────────────────────

const { width: SW } = Dimensions.get('window');
const PAD = Spacing[6];
const INNER_W = SW - PAD * 2;

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function SectionHeader({
  title,
  whisper,
  color,
}: {
  title: string;
  whisper: string;
  color: string;
}) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionTitleRow}>
        <View style={[styles.tick, { backgroundColor: color }]} />
        <Text variant="monoSmall" style={{ color, letterSpacing: 2 }}>{title}</Text>
      </View>
      <Text variant="monoSmall" style={{ color: stageInk(0.4), marginTop: 2 }}>{whisper}</Text>
    </View>
  );
}

// ── Threads: woven strands ────────────────────────────────────────────────

const STRAND_H = 44;
const STRAND_END = INNER_W - 30; // leave room for the arrowhead

function strandY(x: number, seed: number): number {
  return STRAND_H / 2 + 7 * Math.sin((x / STRAND_END) * Math.PI * 2.4 + seed);
}

function strandPath(seed: number): string {
  const pts: string[] = [];
  for (let x = 0; x <= STRAND_END; x += 12) {
    pts.push(`${x === 0 ? 'M' : 'L'}${x},${strandY(x, seed).toFixed(1)}`);
  }
  return pts.join('');
}

export function ThreadStrand({
  data,
  color,
  onPress,
}: {
  data: ThreadSynthesis;
  color: string;
  onPress: () => void;
}) {
  const seed = hashId(data.topicId) % 7;
  const path = useMemo(() => strandPath(seed), [seed]);

  // Beads sit at time-proportional positions: gaps in the strand ARE the gaps
  // in the user's attention. Without a timeline (stale cache), space evenly.
  const beads = useMemo(() => {
    const timeline = data.timeline ?? [];
    if (timeline.length >= 2) {
      const t0 = new Date(timeline[0].capturedAt).getTime();
      const t1 = new Date(timeline[timeline.length - 1].capturedAt).getTime();
      const span = Math.max(1, t1 - t0);
      return timeline.map((node, i) => {
        const x = 8 + ((new Date(node.capturedAt).getTime() - t0) / span) * (STRAND_END - 16);
        return { x, i, n: timeline.length };
      });
    }
    const n = Math.min(7, Math.max(2, data.captureCount));
    return Array.from({ length: n }, (_, i) => ({ x: 8 + (i / (n - 1)) * (STRAND_END - 16), i, n }));
  }, [data]);

  const thickness = 1 + Math.min(1, data.captureCount / 10) * 1.4;

  return (
    <Pressable onPress={onPress} style={styles.strandRow} accessibilityLabel={`Open thread: ${data.topicName}`}>
      {/* Title first, larger, so each strand clearly belongs to its name */}
      <View style={styles.strandTitleRow}>
        <Text variant="h3" numberOfLines={1} style={{ color: stageInk(0.92), flex: 1 }}>
          {data.topicName}
        </Text>
        <Text variant="monoSmall" style={{ color: stageInk(0.35) }}>{data.captureCount} captures</Text>
      </View>
      <Svg width={INNER_W} height={STRAND_H}>
        <Path d={path} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={thickness} />
        {beads.map((b) => {
          const newest = b.i === b.n - 1;
          const r = 2.5 + (b.i / Math.max(1, b.n - 1)) * 2.8;
          const y = strandY(b.x, seed);
          return (
            <React.Fragment key={b.i}>
              {newest && <Circle cx={b.x} cy={y} r={r + 4.5} fill="none" stroke={color} strokeOpacity={0.5} strokeWidth={1} />}
              <Circle cx={b.x} cy={y} r={r} fill={color} fillOpacity={newest ? 0.95 : 0.55} />
            </React.Fragment>
          );
        })}
        {/* Arrowhead — the strand is going somewhere */}
        <Path
          d={`M${STRAND_END + 8},${strandY(STRAND_END, seed) - 5} L${STRAND_END + 16},${strandY(STRAND_END, seed)} L${STRAND_END + 8},${strandY(STRAND_END, seed) + 5}`}
          fill="none"
          stroke={color}
          strokeOpacity={0.8}
          strokeWidth={1.4}
        />
      </Svg>
      {data.heading ? (
        <Text variant="monoSmall" numberOfLines={1} style={{ color, marginTop: Spacing[1] }}>
          → {data.heading}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ── Contradictions: the fault wall ────────────────────────────────────────

const FAULT_ROW_H = 156;

function crackPath(height: number, seed: number): string {
  const pts: string[] = [];
  const STEP = 26;
  for (let y = 0, i = 0; y <= height + STEP; y += STEP, i++) {
    const wobble = ((seed + i * 2654435761) % 21) - 10;
    pts.push(`${i === 0 ? 'M' : 'L'}${(SW / 2 + wobble).toFixed(1)},${Math.min(y, height)}`);
  }
  return pts.join('');
}

export function FaultWall({
  cards,
  color,
  onOpen,
}: {
  cards: ContradictionCard[];
  color: string;
  onOpen: (card: ContradictionCard) => void;
}) {
  const height = cards.length * FAULT_ROW_H;
  const seed = useMemo(() => hashId(cards.map((c) => c.itemAId).join('')), [cards]);
  const crack = useMemo(() => crackPath(height, seed), [height, seed]);

  return (
    <View style={{ height }}>
      <Svg width={SW} height={height} style={StyleSheet.absoluteFill}>
        {/* strata lines — the rows are layers the crack runs through */}
        {cards.map((c, i) => (
          <React.Fragment key={c.itemAId + c.itemBId}>
            {i > 0 && (
              <Line x1={PAD} y1={i * FAULT_ROW_H} x2={SW - PAD} y2={i * FAULT_ROW_H}
                stroke={stageInk(0.07)} strokeWidth={1} />
            )}
          </React.Fragment>
        ))}
        <Path d={crack} fill="none" stroke={color} strokeOpacity={0.12} strokeWidth={7} />
        <Path d={crack} fill="none" stroke={color} strokeOpacity={0.65} strokeWidth={1.4} />
      </Svg>
      {cards.map((card, i) => (
        <Pressable
          key={card.itemAId + card.itemBId}
          onPress={() => onOpen(card)}
          style={[styles.faultRow, { top: i * FAULT_ROW_H }]}
          accessibilityLabel={`Open tension: ${card.labelA} versus ${card.labelB}`}
        >
          <View style={styles.faultLabels}>
            <Text variant="bodyMedium" numberOfLines={2} style={styles.faultLabelA}>
              {card.labelA}
            </Text>
            <Text variant="bodyMedium" numberOfLines={2} style={styles.faultLabelB}>
              {card.labelB}
            </Text>
          </View>
          <View style={[styles.cruxChip, { borderColor: color }]}>
            <Text variant="monoSmall" numberOfLines={2} style={{ color, textAlign: 'center' }}>
              {card.crux ?? 'Tap to see what this turns on'}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// ── Convergence: streams merging ──────────────────────────────────────────

const CONF_H = 96;
const CONF_SVG_W = INNER_W * 0.46;

export function ConfluenceRow({
  data,
  color,
  onPress,
}: {
  data: ConvergenceSignal;
  color: string;
  onPress: () => void;
}) {
  const clusters = (data.clusters ?? []).slice(0, 3);
  const n = Math.max(2, Math.min(3, clusters.length || Math.min(3, data.sourceCount)));
  const nodeX = CONF_SVG_W - 12;
  const nodeY = CONF_H / 2;
  const startYs = n === 2 ? [26, CONF_H - 26] : [18, CONF_H / 2, CONF_H - 18];

  return (
    <Pressable onPress={onPress} style={styles.confRow} accessibilityLabel={`Open convergence: ${data.topicName}`}>
      <Svg width={CONF_SVG_W} height={CONF_H}>
        {startYs.slice(0, n).map((sy, i) => (
          <React.Fragment key={i}>
            <Path
              d={`M10,${sy} C${CONF_SVG_W * 0.55},${sy} ${CONF_SVG_W * 0.6},${nodeY} ${nodeX},${nodeY}`}
              fill="none"
              stroke={color}
              strokeOpacity={0.4}
              strokeWidth={1.2}
            />
            <Circle cx={10} cy={sy} r={3.5} fill={color} fillOpacity={0.55} />
          </React.Fragment>
        ))}
        <Circle cx={nodeX} cy={nodeY} r={11} fill={color} fillOpacity={0.14} />
        <Circle cx={nodeX} cy={nodeY} r={5.5} fill={color} fillOpacity={0.95} />
      </Svg>
      <View style={styles.confMeta}>
        <Text variant="bodyMedium" numberOfLines={1} style={{ color: stageInk(0.9) }}>
          {data.topicName}
        </Text>
        {data.arrival ? (
          <Text variant="monoSmall" numberOfLines={2} style={{ color, marginTop: 2 }}>
            ⌾ {data.arrival}
          </Text>
        ) : null}
        <Text variant="monoSmall" style={{ color: stageInk(0.35), marginTop: 2 }}>
          {data.sourceCount} sources · {data.captureCount} captures
        </Text>
      </View>
    </Pressable>
  );
}

// ── Dormant: embers ───────────────────────────────────────────────────────

export function EmberRow({
  data,
  color,
  onPress,
}: {
  data: DormantThread;
  color: string;
  onPress: () => void;
}) {
  // The longer it's been quiet, the dimmer the ember burns.
  const heat = Math.max(0.22, Math.min(0.85, 1 - (data.daysSilent - 14) / 70));
  return (
    <Pressable onPress={onPress} style={styles.emberRow} accessibilityLabel={`Dormant topic: ${data.topicName}`}>
      <View style={styles.emberDot}>
        <View style={[styles.emberOuter, { borderColor: color, opacity: heat * 0.6 }]} />
        <View style={[styles.emberInner, { backgroundColor: color, opacity: heat }]} />
      </View>
      <Text variant="bodyMedium" numberOfLines={1} style={{ color: stageInk(0.28 + heat * 0.62), flex: 1 }}>
        {data.topicName}
      </Text>
      <Text variant="monoSmall" style={{ color: stageInk(0.35) }}>
        quiet {data.daysSilent}d
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionHead: { paddingHorizontal: PAD, marginTop: Spacing[8], marginBottom: Spacing[4] },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center' },
  tick: { width: 8, height: 2, borderRadius: 1, marginRight: Spacing[2] },

  strandRow: { paddingHorizontal: PAD, marginBottom: Spacing[10] },
  strandTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing[3], marginBottom: Spacing[2] },

  faultRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: FAULT_ROW_H,
    paddingHorizontal: PAD,
    paddingTop: Spacing[5],
  },
  faultLabels: { flexDirection: 'row' },
  faultLabelA: {
    flex: 1,
    color: 'rgba(236,236,236,0.88)',
    textAlign: 'right',
    paddingRight: Spacing[6],
  },
  faultLabelB: {
    flex: 1,
    color: 'rgba(236,236,236,0.88)',
    textAlign: 'left',
    paddingLeft: Spacing[6],
  },
  cruxChip: {
    alignSelf: 'center',
    maxWidth: '80%',
    marginTop: Spacing[5],
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[4],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,12,0.92)',
  },

  confRow: { paddingHorizontal: PAD, marginBottom: Spacing[8], height: CONF_H },
  confMeta: {
    position: 'absolute',
    left: PAD + CONF_SVG_W + Spacing[4],
    right: PAD,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },

  emberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PAD,
    paddingVertical: Spacing[3],
    gap: Spacing[3],
  },
  emberDot: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  emberOuter: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
  },
  emberInner: { width: 8, height: 8, borderRadius: 4 },
});
