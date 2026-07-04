import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Text as SvgText, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import { useApiQuery } from '@/hooks/useApiQuery';
import { Spacing, FontFamily } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { InfoModal } from '@/components/ui/InfoModal';
import type { MemoryTrendsResponse } from '@/types/api';

const { width: SW } = Dimensions.get('window');
const GALAXY_H = 280;
const CLUSTER_PALETTE = [
  '#6B9FD4','#9B84CC','#7EC8A0','#E8A87C','#E87878',
  '#78C8C8','#C4A882','#A0B8D4','#CC84A0','#A8CC84',
];

type Theme = MemoryTrendsResponse['themes'][number];

function computeGalaxyLayout(themes: Theme[], w: number, h: number) {
  if (themes.length === 0) return [];
  const cx = w / 2;
  const cy = h / 2;
  const maxTotal = Math.max(1, ...themes.map((t) => t.total));
  const maxRadius = 48;
  const minRadius = 12;

  return themes.slice(0, 10).map((theme, i) => {
    const r = minRadius + ((theme.total / maxTotal) * (maxRadius - minRadius));
    const recencyRatio = theme.total > 0 ? theme.recent / theme.total : 0;
    const orbitR = (1 - recencyRatio * 0.7) * (Math.min(w, h) * 0.38);
    const angle = (i / Math.min(themes.length, 10)) * Math.PI * 2 - Math.PI / 2;
    return {
      ...theme,
      x: cx + orbitR * Math.cos(angle),
      y: cy + orbitR * Math.sin(angle),
      r,
      color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length] as string,
    };
  });
}

function TopicGalaxy({ data }: { data: MemoryTrendsResponse }) {
  const c = useThemeColors();
  const layout = useMemo(() => computeGalaxyLayout(data.themes, SW, GALAXY_H), [data.themes]);

  if (layout.length === 0) return null;

  return (
    <View style={[styles.galaxyWrap, { height: GALAXY_H }]}>
      <Svg width={SW} height={GALAXY_H}>
        <Defs>
          <RadialGradient id="galaxyGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={c.text} stopOpacity={0.04} />
            <Stop offset="100%" stopColor={c.text} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={SW} height={GALAXY_H} fill="url(#galaxyGlow)" />
        {layout.map((item) => {
          const showLabel = item.r >= 18;
          return (
            <G key={item.topicId}>
              <Circle cx={item.x} cy={item.y} r={item.r * 2.2} fill={item.color} fillOpacity={0.06} />
              <Circle cx={item.x} cy={item.y} r={item.r} fill={item.color} fillOpacity={0.72} />
              {item.delta > 0 && (
                <Circle cx={item.x} cy={item.y} r={item.r + 3} fill="none" stroke={item.color} strokeWidth={0.8} strokeOpacity={0.5} />
              )}
              {showLabel && (
                <SvgText
                  x={item.x}
                  y={item.y + item.r + 11}
                  fontSize={9}
                  fontFamily={FontFamily.mono}
                  fill={c.text}
                  fillOpacity={0.5}
                  textAnchor="middle"
                  letterSpacing={1.5}
                >
                  {item.name.toUpperCase().slice(0, 14)}
                </SvgText>
              )}
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

function PulseLine({ data }: { data: MemoryTrendsResponse }) {
  const c = useThemeColors();
  const rising = data.shifts.filter((s) => s.delta > 0).length;
  const quieting = data.shifts.filter((s) => s.delta < 0).length;
  const active = data.themes.length;
  if (active === 0) return null;
  const parts: string[] = [`${active} topic${active !== 1 ? 's' : ''} active`];
  if (rising > 0) parts.push(`${rising} rising`);
  if (quieting > 0) parts.push(`${quieting} quiet`);
  return (
    <Text variant="monoSmall" style={[styles.pulseLine, { color: c.muted }]}>
      {parts.join('  ·  ')}
    </Text>
  );
}

function TensionRow({ ev }: { ev: MemoryTrendsResponse['events'][number] }) {
  const c = useThemeColors();
  const payload = ev.payload as Record<string, unknown> | null;
  let text = '';
  if (ev.type === 'CONTRADICTION_DETECTED') {
    const count = typeof payload?.neighborCount === 'number' ? payload.neighborCount : 1;
    text = count === 1
      ? 'A new capture pulled against something you already hold.'
      : `A new capture tensioned with ${count} nearby ideas.`;
  } else if (ev.type === 'TOPIC_SHIFT') {
    const name = typeof payload?.name === 'string' ? payload.name : 'a theme';
    const delta = typeof payload?.delta === 'number' ? payload.delta : null;
    if (delta !== null && delta > 0) text = `Attention moved toward ${name}.`;
    else if (delta !== null && delta < 0) text = `${name} faded from recent attention.`;
    else text = `Focus shifted around ${name}.`;
  } else {
    text = ev.type.replace(/_/g, ' ').toLowerCase();
  }
  return (
    <View style={[styles.tensionRow, { borderBottomColor: c.border }]}>
      <View style={[styles.tensionDot, { backgroundColor: c.muted }]} />
      <Text variant="monoSmall" style={{ color: c.muted, flex: 1, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

export default function GalaxyScreen() {
  const c = useThemeColors();
  const [windowKey, setWindowKey] = useState<'week' | 'month'>('week');
  const [infoVisible, setInfoVisible] = useState(false);
  const { data, loading, error, refetch } = useApiQuery(
    () => api.memory.trends({ window: windowKey }),
    [windowKey],
  );
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  if (loading && !data) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text variant="wordmark" color="primary">drift</Text>
        </View>
        <SkeletonCard />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text variant="wordmark" color="primary">drift</Text>
        <View style={styles.headerRight}>
          <View style={styles.toggle}>
            {(['week', 'month'] as const).map((w) => (
              <Pressable
                key={w}
                onPress={() => setWindowKey(w)}
                style={[styles.chip, windowKey === w && { borderBottomColor: c.text, borderBottomWidth: 1 }]}
              >
                <Text variant="monoSmall" style={{ color: windowKey === w ? c.text : c.muted }}>
                  {w === 'week' ? '7d' : '30d'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => setInfoVisible(true)} hitSlop={12} accessibilityLabel="About drift" style={{ marginLeft: Spacing[3] }}>
            <Text style={{ color: c.faint, fontSize: 16 }}>ⓘ</Text>
          </Pressable>
        </View>
      </View>
      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="drift"
        body="Tracks how your attention shifts across topics over time. The galaxy shows your active topics by volume — closer to centre means more recent activity. Tensions surface when new captures pull against ideas you already hold."
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refetch()} tintColor={c.text} />}
        showsVerticalScrollIndicator={false}
      >
        {error || !data ? (
          <View style={styles.centered}>
            <Text variant="monoSmall" style={{ color: c.muted }}>drift unavailable</Text>
            <Pressable onPress={() => void refetch()} style={{ marginTop: Spacing[4] }}>
              <Text variant="monoSmall" style={{ color: c.text }}>retry</Text>
            </Pressable>
          </View>
        ) : data.themes.length === 0 ? (
          <View style={styles.emptyState}>
            <Text variant="serif" color="muted" style={{ textAlign: 'center', marginBottom: Spacing[4] }}>
              your galaxy grows as you capture more
            </Text>
            <Text variant="monoSmall" style={{ color: c.faint, textAlign: 'center', lineHeight: 22 }}>
              {'Drift tracks how your attention\nshifts. Capture a few items\nacross topics to see it emerge.'}
            </Text>
          </View>
        ) : (
          <>
            <TopicGalaxy data={data} />
            <View style={[styles.divider, { borderTopColor: c.border }]} />
            <PulseLine data={data} />
            {data.events.length > 0 && (
              <View style={styles.tensionsSection}>
                <Text variant="label" style={[styles.sectionLabel, { color: c.faint }]}>tensions</Text>
                {data.events.map((ev) => (
                  <TensionRow key={ev.id} ev={ev} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing[6], paddingVertical: Spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  toggle: { flexDirection: 'row', gap: Spacing[3] },
  chip: { paddingBottom: 2 },
  emptyState: { paddingTop: Spacing[20], paddingHorizontal: Spacing[8], alignItems: 'center' },
  content: { paddingBottom: Spacing[16] },
  galaxyWrap: { width: SW, overflow: 'hidden' },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginHorizontal: Spacing[6], marginVertical: Spacing[4] },
  pulseLine: { paddingHorizontal: Spacing[6], marginBottom: Spacing[4], letterSpacing: 0.8 },
  tensionsSection: { paddingHorizontal: Spacing[6], paddingTop: Spacing[5] },
  sectionLabel: { letterSpacing: 2, textTransform: 'uppercase', marginBottom: Spacing[3] },
  tensionRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: Spacing[4], gap: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tensionDot: { width: 4, height: 4, borderRadius: 2, marginTop: 8 },
  centered: { paddingTop: Spacing[10], paddingHorizontal: Spacing[6], alignItems: 'center' },
});
