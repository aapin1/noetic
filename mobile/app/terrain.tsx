import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowDownRight, ArrowUpRight, ChevronLeftIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { AccentList, Radius, Spacing, accentFor } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { AsciiLoader } from '@/components/ui/AsciiLoader';
import { EmptyState } from '@/components/ui/EmptyState';
import type { TerrainField, TerrainResponse } from '@/types/api';

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
        <Text variant="wordmark">terrain</Text>
        <View style={{ width: 24 }} />
      </View>

      {!data && loading ? (
        <AsciiLoader
          variant="cat"
          size={72}
          message={['reading the long view…', 'measuring the drift…', 'tracing where you’ve moved…']}
        />
      ) : !data || !data.unlocked ? (
        <EmptyState
          title="not yet"
          body="terrain opens once you’ve logged enough to have a past to look back on."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text variant="serif" color="secondary" style={styles.lede}>
            how your mind has moved — {data.captureCount} captures, {data.earlyLabel} to {data.recentLabel}.
          </Text>

          {data.arc ? (
            <View style={styles.arcWrap}>
              <View style={[styles.arcRule, { backgroundColor: accent }]} />
              <Text variant="serif" style={styles.arc}>
                {data.arc}
              </Text>
            </View>
          ) : null}

          <Distance data={data} accent={accent} />
          <Spread data={data} accent={accent} />
          <ThenNow data={data} />
          <Composition data={data} accent={accent} />
          <Bridges data={data} accent={accent} />
          <Convictions data={data} accent={accent} />

          <Text variant="monoSmall" color="faint" style={styles.footnote}>
            measured across your earliest and most recent {data.eraSize} captures.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ---------------------------------------------------------------- pieces --- */

function Chapter({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title?: string;
  children: React.ReactNode;
}) {
  const c = useThemeColors();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text variant="label" color="muted" style={styles.kicker}>
        {kicker}
      </Text>
      {title ? (
        <Text variant="h3" style={styles.cardTitle}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function Distance({ data, accent }: { data: TerrainResponse; accent: string }) {
  const c = useThemeColors();
  if (data.driftDegrees === null || data.driftBand === null) return null;

  return (
    <Chapter kicker="distance traveled">
      <View style={styles.distRow}>
        <Text variant="hero" style={[styles.degrees, { color: accent }]}>
          {data.driftDegrees}°
        </Text>
        <Text variant="serif" color="secondary" style={styles.distBand}>
          your center of gravity has turned — {data.driftBand}.
        </Text>
      </View>
      {data.towardField ? (
        <View style={[styles.vector, { borderTopColor: c.borderSubtle }]}>
          <ArrowUpRight size={16} color={accent} strokeWidth={2} />
          <Text variant="serif" style={styles.vectorText}>
            toward <Text variant="serif" style={{ color: accent }}>{data.towardField}</Text>
          </Text>
        </View>
      ) : null}
      {data.awayField ? (
        <View style={styles.vectorTight}>
          <ArrowDownRight size={16} color={c.faint} strokeWidth={2} />
          <Text variant="serif" color="secondary" style={styles.vectorText}>
            away from {data.awayField}
          </Text>
        </View>
      ) : null}
    </Chapter>
  );
}

function Spread({ data, accent }: { data: TerrainResponse; accent: string }) {
  const c = useThemeColors();
  if (data.spreadVerdict === null || data.earlySpread === null || data.recentSpread === null) {
    return null;
  }
  const max = Math.max(1, data.earlySpread, data.recentSpread);
  const verdictLine =
    data.spreadVerdict === 'widening'
      ? 'your attention is fanning outward — reaching across more ground than it used to.'
      : data.spreadVerdict === 'deepening'
        ? 'your attention is drawing inward — settling deeper into fewer things.'
        : 'your range has held steady — neither scattering nor narrowing.';

  return (
    <Chapter kicker="range" title={data.spreadVerdict === 'steady' ? 'holding steady' : data.spreadVerdict}>
      <Text variant="serif" color="secondary" style={styles.body}>
        {verdictLine}
      </Text>
      <View style={styles.spreadRow}>
        <SpreadBar label="then" value={data.earlySpread} max={max} color={c.faint} />
        <SpreadBar label="now" value={data.recentSpread} max={max} color={accent} />
      </View>
    </Chapter>
  );
}

function SpreadBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const c = useThemeColors();
  return (
    <View style={styles.spreadCol}>
      <View style={[styles.spreadTrack, { backgroundColor: c.elevated }]}>
        <View style={[styles.spreadFill, { height: `${Math.round((value / max) * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text variant="monoSmall" color="faint" style={styles.spreadLabel}>
        {label}
      </Text>
    </View>
  );
}

function ThenNow({ data }: { data: TerrainResponse }) {
  if (data.earlyFields.length === 0 && data.recentFields.length === 0) return null;
  return (
    <Chapter kicker="then → now" title="the fields you live in">
      <MiniSpectrum label={data.earlyLabel} items={data.earlyFields} />
      <View style={{ height: Spacing[4] }} />
      <MiniSpectrum label={data.recentLabel} items={data.recentFields} />
    </Chapter>
  );
}

function MiniSpectrum({ label, items }: { label: string; items: TerrainField[] }) {
  const c = useThemeColors();
  if (items.length === 0) {
    return (
      <View>
        <Text variant="monoSmall" color="faint" style={styles.spectrumLabel}>
          {label}
        </Text>
        <Text variant="serif" color="faint">
          —
        </Text>
      </View>
    );
  }
  const total = items.reduce((sum, it) => sum + it.share, 0) || 1;
  return (
    <View>
      <Text variant="monoSmall" color="faint" style={styles.spectrumLabel}>
        {label}
      </Text>
      <View style={[styles.spectrumBar, { backgroundColor: c.elevated }]}>
        {items.map((it, i) => (
          <View key={it.name} style={{ flex: it.share, backgroundColor: AccentList[i % AccentList.length] }} />
        ))}
      </View>
      <View style={styles.legend}>
        {items.map((it, i) => (
          <View key={it.name} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: AccentList[i % AccentList.length] }]} />
            <Text variant="serif" numberOfLines={1} style={styles.legendName}>
              {it.name}
            </Text>
            <Text variant="monoSmall" color="faint">
              {Math.round((it.share / total) * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Composition({ data, accent }: { data: TerrainResponse; accent: string }) {
  if (data.enduring.length === 0 && data.emerged.length === 0 && data.faded.length === 0) return null;
  return (
    <Chapter kicker="what held, what changed">
      {data.enduring.length > 0 ? (
        <ChipGroup title="the enduring core" hint="present the whole way through" names={data.enduring} accent={accent} filled />
      ) : null}
      {data.emerged.length > 0 ? (
        <ChipGroup title="new frontier" hint="ground you’ve only recently entered" names={data.emerged} accent={accent} />
      ) : null}
      {data.faded.length > 0 ? (
        <ChipGroup title="left behind" hint="where you started but no longer go" names={data.faded} muted />
      ) : null}
    </Chapter>
  );
}

function ChipGroup({
  title,
  hint,
  names,
  accent,
  filled,
  muted,
}: {
  title: string;
  hint: string;
  names: string[];
  accent?: string;
  filled?: boolean;
  muted?: boolean;
}) {
  const c = useThemeColors();
  return (
    <View style={styles.chipGroup}>
      <Text variant="serif" style={styles.chipTitle}>
        {title}
      </Text>
      <Text variant="monoSmall" color="faint" style={styles.chipHint}>
        {hint}
      </Text>
      <View style={styles.chipWrap}>
        {names.map((name) => (
          <View
            key={name}
            style={[
              styles.chip,
              filled && accent
                ? { backgroundColor: accent, borderColor: accent }
                : { borderColor: muted ? c.borderSubtle : c.border },
            ]}
          >
            <Text
              variant="monoSmall"
              style={{ color: filled ? '#fff' : muted ? c.faint : c.text, fontSize: 12 }}
            >
              {name}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Bridges({ data, accent }: { data: TerrainResponse; accent: string }) {
  const c = useThemeColors();
  if (data.bridges.length === 0) return null;
  return (
    <Chapter
      kicker="bridges formed"
      title={data.bridgeCount === 1 ? 'a new connection' : `${data.bridgeCount} new connections`}
    >
      <Text variant="serif" color="secondary" style={styles.body}>
        threads you’ve recently drawn between things that used to sit apart.
      </Text>
      <View style={styles.bridgeList}>
        {data.bridges.map((b) => (
          <View key={`${b.a}-${b.b}`} style={[styles.bridgeRow, { borderTopColor: c.borderSubtle }]}>
            <Text variant="serif" numberOfLines={1} style={styles.bridgeEnd}>
              {b.a}
            </Text>
            <Text variant="mono" style={{ color: accent }}>
              ↔
            </Text>
            <Text variant="serif" numberOfLines={1} style={[styles.bridgeEnd, styles.bridgeRight]}>
              {b.b}
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
    <Chapter kicker="convictions">
      <View style={styles.convRow}>
        <ConvStat value={data.positionsStaked} label="staked" color={c.text} />
        <View style={[styles.convDivider, { backgroundColor: c.border }]} />
        <ConvStat value={data.positionsChallenged} label="challenged" color={c.text} />
        <View style={[styles.convDivider, { backgroundColor: c.border }]} />
        <ConvStat value={data.positionsRevised} label="revised" color={accent} />
      </View>
      <Text variant="serif" color="secondary" style={[styles.body, { marginTop: Spacing[4] }]}>
        {data.positionsRevised > 0
          ? 'you’ve let your own later thinking change your mind — the rarest kind of honesty.'
          : 'positions you’ve staked in the ground and stood by.'}
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
      <Text variant="monoSmall" color="faint">
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
  kicker: { marginBottom: Spacing[2] },
  cardTitle: { marginBottom: Spacing[3], textTransform: 'lowercase' },
  body: { lineHeight: 23 },

  distRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[4] },
  degrees: { fontSize: 56, lineHeight: 60 },
  distBand: { flex: 1, lineHeight: 24 },
  vector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    marginTop: Spacing[4],
    paddingTop: Spacing[4],
    borderTopWidth: 1,
  },
  vectorTight: { flexDirection: 'row', alignItems: 'center', gap: Spacing[2], marginTop: Spacing[3] },
  vectorText: { fontSize: 16 },

  spreadRow: { flexDirection: 'row', gap: Spacing[6], marginTop: Spacing[5], height: 90, alignItems: 'flex-end' },
  spreadCol: { flex: 1, alignItems: 'center', gap: Spacing[2] },
  spreadTrack: { width: 40, height: 70, borderRadius: Radius.sm, justifyContent: 'flex-end', overflow: 'hidden' },
  spreadFill: { width: '100%', borderRadius: Radius.sm },
  spreadLabel: {},

  spectrumLabel: { marginBottom: Spacing[2] },
  spectrumBar: { flexDirection: 'row', height: 10, borderRadius: Radius.full, overflow: 'hidden' },
  legend: { marginTop: Spacing[3], gap: Spacing[2] },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing[3] },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  legendName: { flex: 1 },

  chipGroup: { marginTop: Spacing[4] },
  chipTitle: { fontSize: 16 },
  chipHint: { marginTop: 2, marginBottom: Spacing[3] },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing[3],
    paddingVertical: 5,
  },

  bridgeList: { marginTop: Spacing[4] },
  bridgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
    paddingVertical: Spacing[3],
    borderTopWidth: 1,
  },
  bridgeEnd: { flex: 1, fontSize: 15 },
  bridgeRight: { textAlign: 'right' },

  convRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing[2] },
  convStat: { flex: 1, alignItems: 'center', gap: 2 },
  convDivider: { width: 1, height: 34 },

  footnote: { textAlign: 'center', marginTop: Spacing[4] },
});
