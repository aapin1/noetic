import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { ArrowDownRight, ArrowLeftRight, ArrowRight, ArrowUpRight, ChevronLeftIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { AccentList, Radius, Spacing, accentFor } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { plainProse } from '@/lib/text';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { EmptyState } from '@/components/ui/EmptyState';
import type { TerrainCount, TerrainResponse } from '@/types/api';

export default function TerrainScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { data, loading } = useApiQuery(() => api.memory.terrain(), [], {
    cacheKey: 'memory.terrain',
  });

  const accent = accentFor((data?.captureCount ?? 1) * 31);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.canvas }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <ChevronLeftIcon size={24} color={c.text} />
        </Pressable>
        <Text variant="headline">Terrain</Text>
        <View style={{ width: 24 }} />
      </View>

      {!data && loading ? (
        <AsciiLoader
          variant="cat"
          size={72}
          message="Loading…"
        />
      ) : !data || !data.unlocked ? (
        data?.forming ? (
          <Forming data={data} accent={accent} />
        ) : (
          <EmptyState
            title="Not yet"
            body="Terrain opens once you have enough saves to compare over time."
          />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text variant="serif" color="secondary" style={styles.lede}>
            {data.captureCount} captures, {data.earlyLabel} to {data.recentLabel}.
          </Text>

          {data.arc ? (
            <View style={styles.arcWrap}>
              <Text variant="serif" style={styles.arc}>
                {plainProse(data.arc)}
              </Text>
            </View>
          ) : null}

          <Distance data={data} accent={accent} />
          <Range data={data} accent={accent} />
          <Consumption data={data} accent={accent} />
          <Bridges data={data} accent={accent} />
          <LeftBehind data={data} />
          <Convictions data={data} accent={accent} />

          <Text variant="caption" color="muted" style={styles.footnote}>
            Measured across your earliest and most recent {data.eraSize} captures.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* --------------------------------------------------------------- forming --- */

/**
 * The pre-unlock glimpse: what is already true of a young corpus, with the
 * full portrait as a countable horizon. Nothing era-based is faked: drift,
 * eras and bridges are named as what the remaining captures buy.
 */
function Forming({ data, accent }: { data: TerrainResponse; accent: string }) {
  const c = useThemeColors();
  const forming = data.forming!;
  const pct = Math.max(0.04, Math.min(1, data.captureCount / forming.target));

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text variant="serif" color="secondary" style={styles.lede}>
        {data.captureCount} captures{forming.chartingSince ? ` since ${forming.chartingSince}` : ''}. The long view is forming.
      </Text>

      <Chapter kicker="Terrain forming">
        <View style={styles.formingCountRow}>
          <Text variant="hero" style={{ color: accent }}>
            {data.captureCount}
          </Text>
          <Text variant="subheadline" color="secondary">
            of {forming.target}
          </Text>
        </View>
        <View style={[styles.formingTrack, { backgroundColor: c.elevated }]}>
          <View style={[styles.formingFill, { width: `${pct * 100}%`, backgroundColor: accent }]} />
        </View>
        <Text variant="serif" color="secondary" style={styles.body}>
          Drift, eras and bridges need a past to measure against. Keep saving. The full portrait
          opens at {forming.target}.
        </Text>
      </Chapter>

      {forming.distinctTopics > 0 || forming.fields.length > 0 ? (
        <Chapter kicker="First contours">
          {forming.distinctTopics > 0 ? (
            <Text variant="h3" style={styles.rangeHeadline}>
              {forming.distinctTopics === 1 ? 'One subject so far' : `${forming.distinctTopics} subjects so far`}
            </Text>
          ) : null}
          {forming.fields.length > 0 ? (
            <View style={styles.chipWrap}>
              {forming.fields.map((f) => (
                <View key={f.name} style={[styles.chip, { borderColor: c.borderSubtle }]}>
                  <Text variant="captionSmall" color="muted">
                    {f.name}, {Math.round(f.share * 100)}%
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Chapter>
      ) : null}

      {forming.topSources.length > 0 ? (
        <Chapter kicker="What feeds it">
          <BarList title="Where your saves come from" items={forming.topSources} accent={accent} />
        </Chapter>
      ) : null}

      <Text variant="caption" color="muted" style={styles.footnote}>
        This is an early version. The full view compares your earliest saves with your latest.
      </Text>
    </ScrollView>
  );
}

/* ---------------------------------------------------------------- pieces --- */

function Chapter({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  const c = useThemeColors();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text variant="headline" style={styles.kicker}>
        {kicker}
      </Text>
      {children}
    </View>
  );
}

/** A pivot with a "then" ray and a "now" ray swept apart by the drift angle. */
function DriftDial({ degrees, accent }: { degrees: number; accent: string }) {
  const c = useThemeColors();
  const W = 128;
  const H = 92;
  const cx = W / 2;
  const cy = H - 12;
  const R = 66;
  const arcR = 26;
  const shown = Math.max(0, Math.min(168, degrees));
  const rad = (shown * Math.PI) / 180;

  // "then" points straight up; "now" is rotated clockwise by the drift angle.
  const thenPt = { x: cx, y: cy - R };
  const nowPt = { x: cx + R * Math.sin(rad), y: cy - R * Math.cos(rad) };
  const arcStart = { x: cx, y: cy - arcR };
  const arcEnd = { x: cx + arcR * Math.sin(rad), y: cy - arcR * Math.cos(rad) };
  const largeArc = shown > 180 ? 1 : 0;

  return (
    <Svg width={W} height={H}>
      <Path
        d={`M ${arcStart.x} ${arcStart.y} A ${arcR} ${arcR} 0 ${largeArc} 1 ${arcEnd.x} ${arcEnd.y}`}
        stroke={accent}
        strokeWidth={1.5}
        fill="none"
        opacity={0.5}
      />
      <Line x1={cx} y1={cy} x2={thenPt.x} y2={thenPt.y} stroke={c.faint} strokeWidth={2} strokeLinecap="round" />
      <Line x1={cx} y1={cy} x2={nowPt.x} y2={nowPt.y} stroke={accent} strokeWidth={2.5} strokeLinecap="round" />
      <Circle cx={thenPt.x} cy={thenPt.y} r={4} fill={c.surface} stroke={c.faint} strokeWidth={1.5} />
      <Circle cx={nowPt.x} cy={nowPt.y} r={5} fill={accent} />
      <Circle cx={cx} cy={cy} r={3} fill={c.text} />
    </Svg>
  );
}

function Distance({ data, accent }: { data: TerrainResponse; accent: string }) {
  const c = useThemeColors();
  if (data.driftDegrees === null || data.driftBand === null) return null;

  return (
    <Chapter kicker="Distance traveled">
      <View style={styles.distRow}>
        <DriftDial degrees={data.driftDegrees} accent={accent} />
        <View style={styles.distText}>
          <Text variant="hero" style={[styles.degrees, { color: accent }]}>
            {data.driftDegrees}°
          </Text>
          <Text variant="serif" color="secondary" style={styles.distBand}>
            Your center of gravity has turned: {data.driftBand}.
          </Text>
        </View>
      </View>
      {data.towardField ? (
        <View style={[styles.vector, { borderTopColor: c.borderSubtle }]}>
          <ArrowUpRight size={16} color={accent} strokeWidth={2} />
          <Text variant="body">
            Toward <Text variant="body" style={{ color: accent }}>{data.towardField}</Text>
          </Text>
        </View>
      ) : null}
      {data.awayField ? (
        <View style={styles.vectorTight}>
          <ArrowDownRight size={16} color={c.faint} strokeWidth={2} />
          <Text variant="body" color="secondary">
            Away from {data.awayField}
          </Text>
        </View>
      ) : null}
    </Chapter>
  );
}

/** A "deep ←→ wide" track with then/now markers, plus the % shift and subject counts. */
function Range({ data, accent }: { data: TerrainResponse; accent: string }) {
  const c = useThemeColors();
  const hasSpread = data.earlySpread !== null && data.recentSpread !== null;
  const hasCounts = data.earlyDistinctTopics > 0 || data.recentDistinctTopics > 0;
  if (!hasSpread && !hasCounts) return null;

  const pct = data.spreadDeltaPct;
  // Prefer the embedding verdict; if there weren't enough embeddings, fall back
  // to the concrete count of distinct subjects per era.
  const verdict =
    data.spreadVerdict ??
    (data.recentDistinctTopics > data.earlyDistinctTopics
      ? 'widening'
      : data.recentDistinctTopics < data.earlyDistinctTopics
        ? 'deepening'
        : 'steady');
  const headline =
    verdict === 'widening' ? 'Opening outward' : verdict === 'deepening' ? 'Going deeper' : 'Holding its range';
  const line =
    verdict === 'widening'
      ? `You are reaching across ${pct !== null && pct > 0 ? `${pct}% ` : ''}more ground than you started on, and more open to the unfamiliar.`
      : verdict === 'deepening'
        ? `You have drawn in ${pct !== null && pct < 0 ? `${Math.abs(pct)}% ` : ''}tighter, settling deeper into fewer subjects.`
        : 'You range about as widely now as when you began.';

  // Normalize the two spreads onto a shared 0–1 track with a little headroom.
  let thenX = 0.5;
  let nowX = 0.5;
  if (hasSpread) {
    const e = data.earlySpread!;
    const r = data.recentSpread!;
    const lo = Math.min(e, r) * 0.85;
    const hi = Math.max(e, r) * 1.15 || 1;
    const span = hi - lo || 1;
    thenX = Math.max(0.04, Math.min(0.96, (e - lo) / span));
    nowX = Math.max(0.04, Math.min(0.96, (r - lo) / span));
  }

  return (
    <Chapter kicker="Range">
      <Text variant="h3" style={styles.rangeHeadline}>
        {headline}
      </Text>
      <Text variant="serif" color="secondary" style={styles.body}>
        {line}
      </Text>

      {hasSpread ? (
        <View style={styles.rangeTrackWrap}>
          <View style={[styles.rangeTrack, { backgroundColor: c.elevated }]}>
            <View style={[styles.rangeMarker, { left: `${thenX * 100}%`, backgroundColor: c.surface, borderColor: c.faint }]} />
            <View style={[styles.rangeMarkerNow, { left: `${nowX * 100}%`, backgroundColor: accent }]} />
          </View>
          <View style={styles.rangeEnds}>
            <Text variant="captionSmall" color="muted">Deep</Text>
            <Text variant="captionSmall" color="muted">Wide</Text>
          </View>
        </View>
      ) : null}

      {hasCounts ? (
        <View style={[styles.rangeCounts, { borderTopColor: c.borderSubtle }]}>
          <RangeCount value={data.earlyDistinctTopics} label="Subjects then" color={c.faint} />
          <ArrowRight size={18} color={c.faint} />
          <RangeCount value={data.recentDistinctTopics} label="Subjects now" color={accent} />
        </View>
      ) : null}
    </Chapter>
  );
}

function RangeCount({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.rangeCount}>
      <Text variant="h2" style={{ color }}>
        {value}
      </Text>
      <Text variant="caption" color="muted">
        {label}
      </Text>
    </View>
  );
}

/** The reward: what and who you've been pouring hours into. */
function Consumption({ data, accent }: { data: TerrainResponse; accent: string }) {
  if (data.topVoices.length === 0 && data.topSources.length === 0) return null;
  return (
    <Chapter kicker="What you consume">
      {data.topVoices.length > 0 ? (
        <BarList title="Authors you keep returning to" items={data.topVoices} accent={accent} />
      ) : null}
      {data.topSources.length > 0 ? (
        <View style={data.topVoices.length > 0 ? styles.barGap : undefined}>
          <BarList title="Where it comes from" items={data.topSources} accent={accent} />
        </View>
      ) : null}
    </Chapter>
  );
}

function BarList({ title, items, accent }: { title: string; items: TerrainCount[]; accent: string }) {
  const c = useThemeColors();
  const max = Math.max(1, ...items.map((it) => it.count));
  return (
    <View>
      <Text variant="bodySemiBold" style={styles.barTitle}>
        {title}
      </Text>
      {items.map((it, i) => (
        <View key={it.name} style={styles.barRow}>
          <View style={styles.barLabelWrap}>
            <Text variant="subheadline" numberOfLines={1}>
              {it.name}
            </Text>
          </View>
          <View style={styles.barTrackWrap}>
            <View
              style={[
                styles.barFill,
                { width: `${Math.round((it.count / max) * 100)}%`, backgroundColor: i === 0 ? accent : c.faint, opacity: i === 0 ? 1 : 0.5 },
              ]}
            />
          </View>
          <Text variant="tabular" color="muted" style={styles.barCount}>
            {it.count}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Bridges({ data, accent }: { data: TerrainResponse; accent: string }) {
  const c = useThemeColors();
  if (data.bridges.length === 0) return null;
  return (
    <Chapter kicker="Bridges formed">
      <Text variant="h3" style={styles.rangeHeadline}>
        {data.bridgeCount === 1 ? 'A new connection' : `${data.bridgeCount} new connections`}
      </Text>
      <Text variant="serif" color="secondary" style={styles.body}>
        Recent connections between topics that used to be separate.
      </Text>
      <View style={styles.bridgeList}>
        {data.bridges.map((b) => (
          <View key={`${b.a}-${b.b}`} style={[styles.bridgeRow, { borderTopColor: c.borderSubtle }]}>
            <Text variant="subheadline" numberOfLines={1} style={styles.bridgeEnd}>
              {b.a}
            </Text>
            <ArrowLeftRight size={16} color={accent} />
            <Text variant="subheadline" numberOfLines={1} style={[styles.bridgeEnd, styles.bridgeRight]}>
              {b.b}
            </Text>
          </View>
        ))}
      </View>
    </Chapter>
  );
}

/** Slim and a little poignant — the one composition slice nothing else surfaces. */
function LeftBehind({ data }: { data: TerrainResponse }) {
  const c = useThemeColors();
  if (data.faded.length === 0) return null;
  return (
    <Chapter kicker="Left behind">
      <Text variant="serif" color="secondary" style={styles.body}>
        Topics you started with but no longer visit.
      </Text>
      <View style={styles.chipWrap}>
        {data.faded.map((name) => (
          <View key={name} style={[styles.chip, { borderColor: c.borderSubtle }]}>
            <Text variant="captionSmall" color="muted">
              {name}
            </Text>
          </View>
        ))}
      </View>
    </Chapter>
  );
}

function Convictions({ data, accent }: { data: TerrainResponse; accent: string }) {
  const c = useThemeColors();
  if (data.positionsStaked === 0) return null;
  return (
    <Chapter kicker="Convictions">
      <View style={styles.convRow}>
        <ConvStat value={data.positionsStaked} label="Staked" color={c.text} />
        <View style={[styles.convDivider, { backgroundColor: c.border }]} />
        <ConvStat value={data.positionsChallenged} label="Challenged" color={c.text} />
        <View style={[styles.convDivider, { backgroundColor: c.border }]} />
        <ConvStat value={data.positionsRevised} label="Revised" color={accent} />
      </View>
      <Text variant="serif" color="secondary" style={[styles.body, { marginTop: Spacing[4] }]}>
        {data.positionsRevised > 0
          ? 'You have let your own later thinking change your mind.'
          : 'Positions you have staked and stood by.'}
      </Text>
    </Chapter>
  );
}

function ConvStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.convStat}>
      <Text variant="h2" style={{ color }}>
        {value}
      </Text>
      <Text variant="caption" color="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
  },
  content: { paddingHorizontal: Spacing[6], paddingTop: Spacing[6], paddingBottom: Spacing[16] },
  lede: { lineHeight: 24, marginBottom: Spacing[6] },

  arcWrap: { flexDirection: 'row', gap: Spacing[4], marginBottom: Spacing[6] },
  arcRule: { width: 3, borderRadius: Radius.full },
  arc: { flex: 1, fontSize: 20, lineHeight: 30 },

  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing[5],
    marginBottom: Spacing[4],
  },
  kicker: { marginBottom: Spacing[3] },
  body: { lineHeight: 23 },

  distRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[4] },
  distText: { flex: 1 },
  degrees: { fontSize: 48, lineHeight: 52 },
  distBand: { lineHeight: 24, marginTop: Spacing[1] },
  vector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    marginTop: Spacing[4],
    paddingTop: Spacing[4],
    borderTopWidth: 1,
  },
  vectorTight: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginTop: Spacing[3] },

  rangeHeadline: { marginBottom: Spacing[2] },
  rangeTrackWrap: { marginTop: Spacing[5] },
  rangeTrack: {
    height: 8,
    borderRadius: Radius.full,
    justifyContent: 'center',
  },
  rangeMarker: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    marginLeft: -7,
  },
  rangeMarkerNow: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: Radius.full,
    marginLeft: -8,
  },
  rangeEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing[3] },
  rangeCounts: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[5],
    marginTop: Spacing[5],
    paddingTop: Spacing[4],
    borderTopWidth: 1,
  },
  rangeCount: { alignItems: 'center', gap: 2 },

  barTitle: { marginBottom: Spacing[3] },
  barGap: { marginTop: Spacing[5] },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3], marginBottom: Spacing[3] },
  barLabelWrap: { width: '34%' },
  barTrackWrap: { flex: 1 },
  barFill: { height: 8, borderRadius: Radius.full, minWidth: 4 },
  barCount: { width: 24, textAlign: 'right' },

  bridgeList: { marginTop: Spacing[4] },
  bridgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[3],
    borderTopWidth: 1,
  },
  bridgeEnd: { flex: 1 },
  bridgeRight: { textAlign: 'right' },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2], marginTop: Spacing[4] },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: 5,
  },

  formingCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing[2] },
  formingTrack: { height: 8, borderRadius: Radius.full, marginVertical: Spacing[4], overflow: 'hidden' },
  formingFill: { height: 8, borderRadius: Radius.full },

  convRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing[2] },
  convStat: { flex: 1, alignItems: 'center', gap: 2 },
  convDivider: { width: 1, height: 34 },

  footnote: { textAlign: 'center', marginTop: Spacing[4] },
});
